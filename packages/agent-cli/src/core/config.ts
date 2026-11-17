import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicWrite } from './files.js';
export { atomicWrite } from './files.js';
import { z } from 'zod';
import { decimalNumber, parseUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
import { withFileLock } from './lock.js';
export const stateDir = () => join(homedir(), '.bloxwap');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const positive = z
  .number()
  .positive()
  .finite()
  .refine((n) => {
    try {
      return parseUsdc(decimalNumber(n), 18) > 0n;
    } catch {
      return false;
    }
  }, 'Value must be representable with at most 18 decimal places');
export const configSchema = z
  .object({
    version: z.literal(1).default(1),
    revision: z.number().int().nonnegative().default(0),
    network: z.enum(['mainnet', 'testnet']).default('testnet'),
    approvedNetwork: z.enum(['mainnet', 'testnet']).optional(),
    approval: z
      .object({
        network: z.enum(['mainnet', 'testnet']),
        masterAddress: address,
        agentAddress: address,
        validUntil: z.number().int().positive(),
      })
      .strict()
      .optional(),
    mode: z.enum(['live', 'paper']).default('live'),
    paper: z
      .object({
        startingBalance: positive.default(10_000),
      })
      .default({ startingBalance: 10_000 }),
    agentName: z.string().max(16).default('bloxwap'),
    referralCode: z.string().min(1).max(20).default('BLOXWAP'),
    eoaKeyRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$|^file:.+/)
      .optional(),
    masterAddress: address.optional(),
    agentAddress: address.optional(),
    agentExpiry: z.number().int().positive().optional(),
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
interface ConfigSource {
  path: string;
  savedMode: Config['mode'];
  network?: Config['network'];
  mode?: Config['mode'];
}
const sources = new WeakMap<object, ConfigSource>();
export function configSource(config: Config) {
  return sources.get(config);
}
export function setConfigOverrides(
  config: Config,
  overrides: { network?: Config['network']; mode?: Config['mode'] },
) {
  const source = sources.get(config);
  if (source) sources.set(config, { ...source, ...overrides });
}
export function accountLockPath(
  config: Pick<Config, 'mode' | 'network' | 'masterAddress'>,
) {
  return config.mode === 'paper'
    ? join(stateDir(), 'paper', 'state.json.lock')
    : join(
        stateDir(),
        'locks',
        `trade-${config.network}-${(config.masterAddress ?? 'default').toLowerCase()}.lock`,
      );
}
export function bindApproval(config: Config) {
  if (!config.masterAddress || !config.agentAddress || !config.agentExpiry)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Approval identity is incomplete',
    );
  config.approvedNetwork = config.network;
  config.approval = {
    network: config.network,
    masterAddress: config.masterAddress,
    agentAddress: config.agentAddress,
    validUntil: config.agentExpiry,
  };
}
export function assertApprovalIdentity(config: Config) {
  const approved = config.approval;
  if (
    !approved ||
    approved.network !== config.network ||
    approved.masterAddress.toLowerCase() !==
      config.masterAddress?.toLowerCase() ||
    approved.agentAddress.toLowerCase() !==
      config.agentAddress?.toLowerCase() ||
    !config.agentExpiry ||
    config.agentExpiry > approved.validUntil
  )
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Config does not match the verified agent approval; run init on the approved account',
    );
}
export async function refreshConfig(config: Config) {
  const source = sources.get(config);
  if (!source) return config;
  const latest = await loadConfig(source.path);
  if (
    ((await readStoredConfig(source.path))?.mode ?? 'live') !== source.savedMode
  )
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Saved mode changed while the command was pending; retry with the intended mode',
    );
  if (source.network) latest.network = source.network;
  if (source.mode) latest.mode = source.mode;
  if (
    latest.mode !== config.mode ||
    latest.network !== config.network ||
    latest.masterAddress?.toLowerCase() !== config.masterAddress?.toLowerCase()
  )
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Account identity changed while the command was pending',
    );
  for (const key of Object.keys(config))
    delete (config as Record<string, unknown>)[key];
  Object.assign(config, latest);
  return config;
}
export const configPath = () => join(stateDir(), 'config.json');
// Managed Privy signing was removed: agents are user-provided EOA keys. Configs
// written by earlier releases still load; an agent they approved keeps its
// address so it can be rotated to an EOA key or revoked.
const removedKeys = [
  'signerType',
  'privyAppId',
  'privyWalletId',
  'privyAppSecretRef',
  'authorizationKeyRef',
  'policyId',
  'policyVersion',
];
export function migrate(raw: unknown): Config {
  if (raw && typeof raw === 'object') {
    const next: Record<string, unknown> = { version: 1, ...raw };
    for (const key of removedKeys) delete next[key];
    raw = next;
  }
  const result = configSchema.safeParse(raw);
  if (!result.success)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Invalid config',
      result.error.flatten(),
    );
  const config = result.data;
  // Pin legacy approvals before applying any environment overrides. Subsequent
  // writes keep this tuple, so changing a master cannot carry its approval over.
  if (
    !config.approval &&
    config.approved &&
    config.approvedNetwork &&
    config.masterAddress &&
    config.agentAddress &&
    config.agentExpiry
  )
    config.approval = {
      network: config.approvedNetwork,
      masterAddress: config.masterAddress,
      agentAddress: config.agentAddress,
      validUntil: config.agentExpiry,
    };
  return config;
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
  const savedMode = config.mode;
  for (const [name, key] of Object.entries({
    BLOXWAP_NETWORK: 'network',
    BLOXWAP_MODE: 'mode',
    BLOXWAP_LOG_LEVEL: 'logLevel',
    BLOXWAP_MASTER_ADDRESS: 'masterAddress',
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
  const result = migrate(config);
  if (result.approved && result.approval) assertApprovalIdentity(result);
  sources.set(result, { path: resolve(path), savedMode });
  return result;
}
async function writeConfigUnlocked(config: Config, path: string) {
  await atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
}
export async function saveConfig(
  config: unknown,
  path = configPath(),
): Promise<Config> {
  const incoming = migrate(config);
  const snapshot = await readStoredConfig(path);
  return withFileLock(accountLockPath(snapshot ?? incoming), () =>
    withFileLock(`${path}.lock`, async () => {
      const current = await readStoredConfig(path);
      if (current && incoming.revision !== current.revision)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Config changed concurrently',
          { expected: incoming.revision, actual: current.revision },
        );
      if (incoming.approved && incoming.approval)
        assertApprovalIdentity(incoming);
      const next = migrate({
        ...incoming,
        revision: (current?.revision ?? 0) + 1,
      });
      await writeConfigUnlocked(next, path);
      if (config && typeof config === 'object') {
        Object.assign(config, { revision: next.revision });
        sources.set(config, { path: resolve(path), savedMode: next.mode });
      }
      sources.set(next, { path: resolve(path), savedMode: next.mode });
      return next;
    }),
  );
}
export function copyAgentFields(target: Config, source: Config) {
  target.agentAddress = source.agentAddress;
  target.eoaKeyRef = source.eoaKeyRef;
  target.agentExpiry = source.agentExpiry;
  target.agentName = source.agentName;
  target.approved = true;
  target.revoked = false;
  bindApproval(target);
}
export async function updateConfig(
  path: string,
  mutate: (config: Config) => void,
): Promise<Config> {
  const snapshot = await readStoredConfig(path);
  if (!snapshot) throw new AgentCliError('CONFIG_INVALID', 'Config is missing');
  return withFileLock(accountLockPath(snapshot), () =>
    withFileLock(`${path}.lock`, async () => {
      const current = await readStoredConfig(path);
      if (!current)
        throw new AgentCliError('CONFIG_INVALID', 'Config is missing');
      if (current.revision !== snapshot.revision)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Config changed concurrently',
        );
      const revision = current.revision;
      mutate(current);
      const next = migrate({ ...current, revision: revision + 1 });
      if (next.approved && next.approval) assertApprovalIdentity(next);
      await writeConfigUnlocked(next, path);
      sources.set(next, { path: resolve(path), savedMode: next.mode });
      return next;
    }),
  );
}
