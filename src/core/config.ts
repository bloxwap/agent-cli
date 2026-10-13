import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentCliError } from '../errors/index.js';
export const stateDir = () => join(homedir(), '.bloxwap');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const positive = z.number().positive().finite();
export const configSchema = z
  .object({
    version: z.literal(1).default(1),
    network: z.enum(['mainnet', 'testnet']).default('testnet'),
    agentName: z.string().max(16).default('bloxwap'),
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
        address: address.optional(),
        fee: z.number().int().min(0).max(100).default(0),
      })
      .default({ fee: 0 }),
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
export async function loadConfig(
  path = configPath(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AgentCliError('CONFIG_INVALID', 'Cannot read config');
  }
  const config = migrate(raw);
  for (const [name, key] of Object.entries({
    BLOXWAP_NETWORK: 'network',
    BLOXWAP_LOG_LEVEL: 'logLevel',
    BLOXWAP_PRIVY_APP_ID: 'privyAppId',
    BLOXWAP_MASTER_ADDRESS: 'masterAddress',
  })) {
    if (env[name]) Object.assign(config, { [key]: env[name] });
  }
  return migrate(config);
}
export async function saveConfig(config: unknown, path = configPath()) {
  await atomicWrite(path, JSON.stringify(migrate(config), null, 2) + '\n');
}
