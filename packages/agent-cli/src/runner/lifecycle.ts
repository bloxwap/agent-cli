import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, mkdir, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  stateDir,
  atomicWrite,
  configSource,
  type Config,
} from '../core/config.js';
import { paperDir, type Mode } from '../core/mode.js';
import { Logger } from '../core/logger.js';
import { openSigner as configuredSigner } from '../wallet/signer.js';
import type { Signer } from '../core/hlclient.js';
import { AgentCliError } from '../errors/index.js';
import {
  holderState,
  acquireFileLock,
  withFileLock,
  type FileLease,
} from '../core/lock.js';
export const STARTUP_TIMEOUT_MS = 30_000;
export interface RunnerInfo {
  pid: number;
  startedAt: number;
  network: Config['network'];
  ready: boolean;
  token: string;
  status?: 'starting' | 'ready' | 'unresponsive';
  account?: string;
  mode?: Mode;
  configPath?: string;
}
export const runnerPidPath = (mode: Mode = 'live') =>
  join(mode === 'paper' ? paperDir() : stateDir(), 'runner.pid');
export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
export async function runningInfo(
  path = runnerPidPath(),
): Promise<RunnerInfo | null> {
  let info: RunnerInfo;
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    if (
      Number.isSafeInteger(raw?.pid) &&
      raw.pid > 0 &&
      holderState({
        pid: raw.pid,
        createdAt: raw.startedAt ?? 0,
        token: raw.token ?? '',
      }) === 'dead'
    )
      return null;
    info = z
      .object({
        pid: z.number().int().positive(),
        startedAt: z.number().int().nonnegative(),
        network: z.enum(['mainnet', 'testnet']),
        ready: z.boolean(),
        token: z.string().min(1),
        status: z.enum(['starting', 'ready', 'unresponsive']).optional(),
        account: z.string().optional(),
        mode: z.enum(['live', 'paper']).optional(),
        configPath: z.string().optional(),
      })
      .parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Invalid runner ownership record; inspect before restarting',
      { path },
    );
  }
  if (!Number.isInteger(info.pid) || info.pid <= 0 || !info.token) return null;
  const holder = holderState({
    pid: info.pid,
    createdAt: info.startedAt,
    token: info.token,
  });
  if (holder === 'dead' || holder === 'reused') return null;
  if (holder === 'unknown')
    return { ...info, ready: false, status: 'unresponsive' };
  if (
    activeRunner &&
    activeRunner.info.pid === info.pid &&
    activeRunner.info.token === info.token
  )
    return { ...info, ready: activeRunner.info.ready };
  if (!info.ready)
    return {
      ...info,
      status:
        Date.now() - info.startedAt > STARTUP_TIMEOUT_MS
          ? 'unresponsive'
          : 'starting',
    };
  try {
    const { rpcCall, socketPath } = await import('./rpc.js');
    const pong = (await rpcCall(
      'runner.ping',
      {},
      socketPath(dirname(path)),
      1_000,
    )) as { token?: string };
    return pong?.token === info.token
      ? info
      : { ...info, ready: false, status: 'unresponsive' };
  } catch {
    return { ...info, ready: false, status: 'unresponsive' };
  }
}
export class Runner {
  subscriptions?: {
    state: string;
    lastMessage: number;
    lastFill: number | null;
  };
  readonly info: RunnerInfo;
  readonly logger: Logger;
  signer?: Signer;
  private timer?: NodeJS.Timeout;
  private cleanup: (() => Promise<void>)[] = [];
  private closing = false;
  private lease?: FileLease;
  private admission: (() => Promise<void>)[] = [];
  constructor(
    readonly config: Config,
    readonly directory = stateDir(),
  ) {
    this.info = {
      pid: process.pid,
      startedAt: Date.now(),
      network: config.network,
      ready: false,
      token: randomUUID(),
      account: config.masterAddress?.toLowerCase(),
      mode: config.mode,
      configPath: resolve(
        configSource(config)?.path ?? join(stateDir(), 'config.json'),
      ),
    };
    this.logger = new Logger({
      level: config.logLevel,
      directory: join(directory, 'logs'),
    });
  }
  async start(
    loadSigner: () => Promise<Signer> = async () =>
      configuredSigner(this.config),
  ) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const path = join(this.directory, 'runner.pid');
    const existing = await withFileLock(
      path + '.startup',
      async () => {
        const current = await runningInfo(path);
        if (current) {
          if (
            current.network !== this.config.network ||
            (current.mode && current.mode !== this.config.mode) ||
            (current.account &&
              current.account !== this.config.masterAddress?.toLowerCase()) ||
            (current.configPath && current.configPath !== this.info.configPath)
          )
            throw new AgentCliError(
              'CONFIG_INVALID',
              'Runner belongs to a different config, account, network or mode',
            );
          return current;
        }
        this.lease = await acquireFileLock(path + '.owner', { staleMs: 1000 });
        try {
          await atomicWrite(path, JSON.stringify(this.info));
        } catch (error) {
          await this.lease.release();
          this.lease = undefined;
          throw error;
        }
        return null;
      },
      { staleMs: 1000 },
    );
    if (existing) return { existing: true, ...existing };
    try {
      this.signer = await loadSigner();
      this.timer = setInterval(() => {}, 30_000);
      this.logger.log('info', 'Runner started', { ...this.info });
      await this.logger.flush();
      return { existing: false, ...this.info };
    } catch (error) {
      if (this.timer) clearInterval(this.timer);
      this.signer = undefined;
      await this.releaseOwnership();
      throw error;
    }
  }
  async markReady() {
    this.info.ready = true;
    this.info.status = 'ready';
    await atomicWrite(
      join(this.directory, 'runner.pid'),
      JSON.stringify(this.info),
    );
  }
  onStopAdmission(cleanup: () => Promise<void>) {
    this.admission.push(cleanup);
  }
  private async releaseOwnership() {
    const path = join(this.directory, 'runner.pid');
    try {
      const current = JSON.parse(await readFile(path, 'utf8'));
      if (current.token === this.info.token) await unlink(path);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !(error instanceof SyntaxError)
      )
        throw error;
    } finally {
      await this.lease?.release();
      this.lease = undefined;
    }
  }
  onShutdown(cleanup: () => Promise<void>) {
    this.cleanup.push(cleanup);
  }
  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    const errors: unknown[] = [];
    for (const cleanup of [...this.admission, ...this.cleanup.reverse()])
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    this.signer = undefined;
    this.logger.log('info', 'Runner stopped');
    try {
      await this.logger.flush();
    } catch (error) {
      errors.push(error);
    }
    await this.releaseOwnership();
    if (activeRunner === this) activeRunner = undefined;
    if (errors.length)
      throw new AggregateError(errors, 'Runner cleanup failed');
  }
  signals() {
    const handler = () => {
      void this.shutdown().catch((error) => {
        process.stderr.write(String(error) + '\n');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
    this.onShutdown(async () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    });
  }
}
export async function detachRunner(args: string[], path = runnerPidPath()) {
  const existing = await runningInfo(path);
  if (existing) return existing;
  const compiled =
    Boolean(process.versions.bun) && import.meta.url.includes('/$bunfs/');
  const child = spawn(
    process.execPath,
    compiled ? ['run', ...args] : [process.argv[1], 'run', ...args],
    { detached: true, stdio: 'ignore', env: process.env },
  );
  child.unref();
  for (let i = 0; i < 600; i++) {
    const info = await runningInfo(path);
    if (info?.ready) return info;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new AgentCliError(
    'RUNNER_NOT_RUNNING',
    'Detached runner did not become ready',
  );
}
export let activeRunner: Runner | undefined;
export function setActiveRunner(runner: Runner | undefined) {
  activeRunner = runner;
}
