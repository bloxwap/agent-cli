import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentCliError } from '../errors/index.js';
import { withFileLock } from './lock.js';
export const stateDir = () => join(homedir(), '.bloxwap');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const positive = z.number().positive().finite();
export const configSchema = z
  .object({
    version: z.literal(1).default(1),
    revision: z.number().int().nonnegative().default(0),
    network: z.enum(['mainnet', 'testnet']).default('testnet'),
    approvedNetwork: z.enum(['mainnet', 'testnet']).optional(),
    mode: z.enum(['live', 'paper']).default('live'),
    paper: z
      .object({
        startingBalance: positive.default(10_000),
      })
      .default({ startingBalance: 10_000 }),
    agentName: z.string().max(16).default('bloxwap'),
    referralCode: z.string().min(1).max(20).default('BLOXWAP'),
    signerType: z.enum(['privy', 'eoa']).default('privy'),
    eoaKeyRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$|^file:.+/)
      .optional(),
    masterAddress: address.optional(),
    agentAddress: address.optional(),
    agentExpiry: z.number().int().positive().optional(),
    privyAppId: z.string().optional(),
    privyWalletId: z.string().optional(),
    policyId: z.string().optional(),
    policyVersion: z.number().int().optional(),
    authorizationKeyRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$|^file:.+/)
      .optional(),
    privyAppSecretRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$/)
      .optional(),
    revoked: z.boolean().default(false),
    approved: z.boolean().default(false),
    limits: z
      .object({
        maxNotional: positive.optional(),
        maxPositionNotional: positive.optional(),
        maxLeverage: positive.optional(),
        maxOrderSize: positive.optional(),
        dailyLoss: positive.optional(),
        maxOpenOrders: z.number().int().nonnegative().optional(),
      })
      .default({}),
    allowedMarkets: z.array(z.string()).default([]),
    builder: z
      .object({
        address: address.default('0x71b09A08257078A4d642F7Dd7315e656c837329a'),
        fee: z.number().int().min(0).max(100).default(0),
      })
      .default({
        address: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
        fee: 0,
      }),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    runnerFallback: z.boolean().default(true),
    expiryWarningDays: z.array(positive).default([14, 3, 1]),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const configPath = () => join(stateDir(), 'config.json');
export async function atomicWrite(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
export function migrate(raw: unknown): Config {
  if (raw && typeof raw === 'object' && !('version' in raw))
    raw = { ...raw, version: 1 };
  const result = configSchema.safeParse(raw);
  if (!result.success)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Invalid config',
      result.error.flatten(),
    );
  return result.data;
}
export async function readStoredConfig(
  path = configPath(),
): Promise<Config | null> {
  try {
    return migrate(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AgentCliError('CONFIG_INVALID', 'Cannot read config');
  }
}
export async function loadConfig(
  path = configPath(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  const config = (await readStoredConfig(path)) ?? migrate({});
  for (const [name, key] of Object.entries({
    BLOXWAP_NETWORK: 'network',
    BLOXWAP_MODE: 'mode',
    BLOXWAP_LOG_LEVEL: 'logLevel',
    BLOXWAP_PRIVY_APP_ID: 'privyAppId',
    BLOXWAP_MASTER_ADDRESS: 'masterAddress',
    BLOXWAP_SIGNER_TYPE: 'signerType',
  })) {
    if (env[name]) Object.assign(config, { [key]: env[name] });
  }
  if (env.BLOXWAP_REFERRAL_CODE !== undefined)
    config.referralCode = env.BLOXWAP_REFERRAL_CODE;
  if (env.BLOXWAP_BUILDER_ADDRESS !== undefined)
    config.builder.address = env.BLOXWAP_BUILDER_ADDRESS;
  if (env.BLOXWAP_BUILDER_FEE !== undefined)
    config.builder.fee = env.BLOXWAP_BUILDER_FEE.trim()
      ? Number(env.BLOXWAP_BUILDER_FEE)
      : NaN;
  return migrate(config);
}
async function writeConfigUnlocked(config: Config, path: string) {
  await atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
}
export async function saveConfig(
  config: unknown,
  path = configPath(),
): Promise<Config> {
  return withFileLock(`${path}.lock`, async () => {
    const incoming = migrate(config);
    const current = await readStoredConfig(path);
    if (current && incoming.revision !== current.revision)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Config changed concurrently',
        { expected: incoming.revision, actual: current.revision },
      );
    const next = migrate({
      ...incoming,
      revision: (current?.revision ?? 0) + 1,
    });
    await writeConfigUnlocked(next, path);
    if (config && typeof config === 'object')
      Object.assign(config, { revision: next.revision });
    return next;
  });
}
export function copyAgentFields(target: Config, source: Config) {
  target.agentAddress = source.agentAddress;
  target.privyWalletId = source.privyWalletId;
  target.authorizationKeyRef = source.authorizationKeyRef;
  target.eoaKeyRef = source.eoaKeyRef;
  target.agentExpiry = source.agentExpiry;
  target.agentName = source.agentName;
  target.approved = true;
  target.revoked = false;
  if (!target.approvedNetwork) target.approvedNetwork = target.network;
}
export async function updateConfig(
  path: string,
  mutate: (config: Config) => void,
): Promise<Config> {
  return withFileLock(`${path}.lock`, async () => {
    const current = await readStoredConfig(path);
    if (!current)
      throw new AgentCliError('CONFIG_INVALID', 'Config is missing');
    const revision = current.revision;
    mutate(current);
    const next = migrate({ ...current, revision: revision + 1 });
    await writeConfigUnlocked(next, path);
    return next;
  });
}
