import type { Subscriptions } from './subscriptions.js';
import { randomUUID } from 'node:crypto';
import { open, readFile, unlink, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { stateDir, atomicWrite, type Config } from '../core/config.js';
import { paperDir, type Mode } from '../core/mode.js';
import { Logger } from '../core/logger.js';
import { openSigner as configuredSigner } from '../wallet/signer.js';
import type { Signer } from '../core/hlclient.js';
import { AgentCliError } from '../errors/index.js';
import { pidLiveness, readLock } from '../core/lock.js';
export const STARTUP_TIMEOUT_MS = 30_000;
export interface RunnerInfo {
  pid: number;
  startedAt: number;
  network: Config['network'];
  ready: boolean;
  token: string;
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
    info = JSON.parse(await readFile(path, 'utf8')) as RunnerInfo;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError
    )
      return null;
    throw error;
  }
  if (!Number.isInteger(info.pid) || info.pid <= 0 || !info.token) return null;
  if (pidLiveness(info.pid) !== 'alive') return null;
  if (
    activeRunner &&
    activeRunner.info.pid === info.pid &&
    activeRunner.info.token === info.token
  )
    return { ...info, ready: activeRunner.info.ready };
  if (!info.ready)
    return Date.now() - info.startedAt > STARTUP_TIMEOUT_MS ? null : info;
  try {
    const { rpcCall, socketPath } = await import('./rpc.js');
    const pong = (await rpcCall(
      'runner.ping',
      {},
      socketPath(dirname(path)),
      1_000,
    )) as { token?: string };
    return pong?.token === info.token ? info : null;
  } catch {
    return null;
  }
}
async function acquireStartupLock(lockPath: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const guard = await open(lockPath, 'wx', 0o600);
      const token = randomUUID();
      await guard.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }),
      );
      await guard.sync();
      return { guard, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const record = await readLock(lockPath);
      const stale =
        !record ||
        pidLiveness(record.pid) !== 'alive' ||
        Date.now() - record.createdAt > STARTUP_TIMEOUT_MS;
      if (!stale)
        throw new AgentCliError(
          'RUNNER_NOT_RUNNING',
          'Runner startup in progress; retry shortly',
          { lock: lockPath },
          true,
        );
      await unlink(lockPath).catch(() => {});
    }
  }
  throw new AgentCliError(
    'RUNNER_NOT_RUNNING',
    'Runner startup in progress; retry shortly',
    { lock: lockPath },
    true,
  );
}
export class Runner {
  subscriptions?: Subscriptions;
  readonly info: RunnerInfo;
  readonly logger: Logger;
  signer?: Signer;
  private timer?: NodeJS.Timeout;
  private cleanup: (() => Promise<void>)[] = [];
  private closing = false;
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
    const startupLock = path + '.startup';
    const { guard, token } = await acquireStartupLock(startupLock);
    let handle;
    try {
      const existing = await runningInfo(path);
      if (existing) return { existing: true, ...existing };
      await unlink(path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(this.info));
      await handle.close();
    } finally {
      await guard.close();
      const current = await readLock(startupLock);
      if (current?.token === token) await unlink(startupLock).catch(() => {});
    }
    try {
      this.signer = await loadSigner();
      this.timer = setInterval(() => {}, 30_000);
      this.logger.log('info', 'Runner started', { ...this.info });
      await this.logger.flush();
      return { existing: false, ...this.info };
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
  }
  async markReady() {
    this.info.ready = true;
    await atomicWrite(
      join(this.directory, 'runner.pid'),
      JSON.stringify(this.info),
    );
  }
  onShutdown(cleanup: () => Promise<void>) {
    this.cleanup.push(cleanup);
  }
  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    const errors: unknown[] = [];
    for (const cleanup of this.cleanup.reverse())
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    this.signer = undefined;
    this.logger.log('info', 'Runner stopped');
    await this.logger.flush();
    await unlink(join(this.directory, 'runner.pid')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
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
  if (existing?.ready) return existing;
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
