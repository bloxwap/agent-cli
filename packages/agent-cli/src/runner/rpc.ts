import { assertSafeInput } from '../wallet/safety.js';
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from 'node:net';
import { chmod, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  stateDir,
  loadConfig,
  readStoredConfig,
  atomicWrite,
} from '../core/config.js';
import { resolveMode, type Mode } from '../core/mode.js';
import { AgentCliError, normalizeError } from '../errors/index.js';
import { commands, type Context } from '../core/router.js';
import { runningInfo, type Runner } from './lifecycle.js';
export const socketPath = (directory = stateDir()) =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\bloxwap-${createHash('sha256').update(directory).digest('hex').slice(0, 24)}`
    : join(directory, 'run.sock');
const aliases: Record<string, string> = {
  'status.get': 'status',
  'market.get': 'market',
  'balance.get': 'balance',
  'positions.get': 'positions',
  'orders.get': 'orders',
  'order.place': 'order',
  'order.cancel': 'cancel',
  'order.modify': 'modify',
  'leverage.set': 'leverage',
  'config.get': 'config',
  'runner.shutdown': 'shutdown',
};
export const routedCommands = new Set([
  'market',
  'status',
  'balance',
  'positions',
  'orders',
  'order',
  'cancel',
  'modify',
  'leverage',
  'rotate',
  'revoke',
]);
export const MAX_RPC_BYTES = 1_048_576;
const MAX_QUEUED_REQUESTS = 64;
const MAX_QUEUED_BYTES = 4 * MAX_RPC_BYTES;
const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().max(128), z.number().finite(), z.null()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export async function rpcServer(
  runner: Runner,
  context: Context,
  execute?: (name: string, input: Record<string, unknown>) => Promise<unknown>,
): Promise<Server> {
  const path = socketPath(runner.directory);
  let queue = Promise.resolve();
  const sockets = new Set<Socket>();
  let stopping = false;
  let queued = 0;
  let queuedBytes = 0;
  const savedMode =
    (await readStoredConfig(context.configPath))?.mode ?? 'live';
  const server = createServer((socket) => {
    if (stopping || sockets.size >= 128) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on('data', (chunk) => {
      if (socket.writableLength > MAX_RPC_BYTES) {
        socket.destroy();
        return;
      }
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_RPC_BYTES) {
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        // Health checks never wait behind a command or external service.
        try {
          const ping = requestSchema.safeParse(JSON.parse(line));
          if (ping.success && ping.data.method === 'runner.ping') {
            socket.write(
              JSON.stringify({
                jsonrpc: '2.0',
                id: ping.data.id,
                result: { token: runner.info.token, pid: runner.info.pid },
              }) + '\n',
            );
            continue;
          }
        } catch {
          /* the queued parser returns a normalized error */
        }
        const bytes = Buffer.byteLength(line);
        if (
          stopping ||
          queued >= MAX_QUEUED_REQUESTS ||
          queuedBytes + bytes > MAX_QUEUED_BYTES
        ) {
          socket.destroy();
          return;
        }
        queued++;
        queuedBytes += bytes;
        queue = queue
          .then(async () => {
            let id: unknown = null;
            let actionName = '';
            let cloid: unknown;
            try {
              if (stopping)
                throw new AgentCliError(
                  'RUNNER_NOT_RUNNING',
                  'Runner stopping',
                );
              const request = requestSchema.parse(JSON.parse(line));
              id = request.id;
              const metadata = request.params.__context as
                | {
                    configPath?: string;
                    network?: string;
                    mode?: Mode;
                  }
                | undefined;
              if (
                metadata &&
                ((metadata.network &&
                  metadata.network !== runner.config.network) ||
                  (metadata.configPath &&
                    resolve(metadata.configPath) !==
                      resolve(
                        context.configPath ?? join(stateDir(), 'config.json'),
                      )))
              )
                throw new AgentCliError(
                  'CONFIG_INVALID',
                  'Runner belongs to a different config or network',
                );
              const name = aliases[request.method] ?? request.method;
              actionName = name;
              cloid = request.params.cloid;
              if (name === 'runner.ping') {
                socket.write(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    result: {
                      token: runner.info.token,
                      pid: runner.info.pid,
                    },
                  }) + '\n',
                );
                return;
              }
              const pinned: Mode =
                runner.config.mode === 'paper' ? 'paper' : 'live';
              if (metadata?.mode && metadata.mode !== pinned)
                throw new AgentCliError(
                  'CONFIG_INVALID',
                  'Runner mode does not match the caller',
                  { runnerMode: pinned, requested: metadata.mode },
                );
              {
                const disk = await readStoredConfig(
                  context.configPath ?? join(stateDir(), 'config.json'),
                );
                if (disk && disk.mode !== savedMode)
                  throw new AgentCliError(
                    'CONFIG_INVALID',
                    'Runner mode does not match the saved config; restart the runner',
                    { runnerMode: pinned, configMode: disk.mode },
                  );
              }
              if (name === 'shutdown') {
                socket.write(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    result: { stopping: true },
                  }) + '\n',
                );
                setImmediate(() => {
                  void runner.shutdown();
                });
                return;
              }
              if (!routedCommands.has(name) && name !== 'config')
                throw new AgentCliError(
                  'CONFIG_INVALID',
                  'Unknown runner method',
                );
              const command = commands.get(name);
              if (!command && !execute)
                throw new AgentCliError('CONFIG_INVALID', 'Unavailable method');
              assertSafeInput(request.params);
              const { __context, ...params } = request.params;
              void __context;
              const input = name === 'config' ? { args: ['get'] } : params;
              const parsed = command?.schema.safeParse(input);
              if (parsed && !parsed.success)
                throw new AgentCliError(
                  'CONFIG_INVALID',
                  'Invalid runner input',
                );
              const data = execute
                ? await execute(name, input)
                : await command!.execute(
                    parsed!.data as Record<string, unknown>,
                    { ...context, runner: true, paper: pinned === 'paper' },
                  );
              const encoded =
                JSON.stringify({ jsonrpc: '2.0', id, result: data }) + '\n';
              if (Buffer.byteLength(encoded) > MAX_RPC_BYTES) {
                if (
                  [
                    'order',
                    'cancel',
                    'modify',
                    'leverage',
                    'rotate',
                    'revoke',
                  ].includes(name)
                ) {
                  const resultPath = join(
                    runner.directory,
                    'results',
                    randomUUID() + '.json',
                  );
                  try {
                    await atomicWrite(resultPath, JSON.stringify(data));
                  } catch {
                    throw new AgentCliError(
                      'INTERNAL',
                      'Action completed but its oversized result could not be persisted',
                      { outcome: 'accepted', cloid, receiptUnavailable: true },
                      false,
                    );
                  }
                  if (!socket.destroyed)
                    socket.write(
                      JSON.stringify({
                        jsonrpc: '2.0',
                        id,
                        result: { outcome: 'accepted', resultPath, cloid },
                      }) + '\n',
                    );
                  return;
                }
                throw new AgentCliError(
                  'CONFIG_INVALID',
                  'Runner response exceeds frame limit; request a smaller page',
                  { maxBytes: MAX_RPC_BYTES },
                  false,
                );
              }
              if (!socket.destroyed) socket.write(encoded);
            } catch (error) {
              const normalized =
                error instanceof SyntaxError || error instanceof z.ZodError
                  ? new AgentCliError(
                      'CONFIG_INVALID',
                      'Invalid JSON-RPC request',
                    )
                  : normalizeError(error);
              let errorData = normalized.toJSON();
              if (
                Buffer.byteLength(JSON.stringify(errorData)) >
                MAX_RPC_BYTES / 2
              ) {
                const resultPath = join(
                  runner.directory,
                  'results',
                  randomUUID() + '.json',
                );
                let saved = false;
                try {
                  await atomicWrite(resultPath, JSON.stringify(errorData));
                  saved = true;
                } catch {
                  /* preserve the action outcome even when the receipt cannot be written */
                }
                const details = normalized.details as
                  { outcome?: unknown } | undefined;
                errorData = new AgentCliError(
                  normalized.code,
                  normalized.message.slice(0, 1000),
                  {
                    outcome:
                      details?.outcome ??
                      (routedCommands.has(actionName) ? 'unknown' : undefined),
                    cloid,
                    ...(saved ? { resultPath } : { receiptUnavailable: true }),
                  },
                  false,
                ).toJSON();
              }
              if (!socket.destroyed)
                socket.write(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: {
                      code: -32000,
                      message: normalized.message.slice(0, 1000),
                      data: errorData,
                    },
                  }) + '\n',
                );
            }
          })
          .finally(() => {
            queued--;
            queuedBytes -= bytes;
          })
          .catch((error) => {
            runner.logger.log('error', 'RPC write failed', {
              error: String(error),
            });
            socket.destroy();
          });
      }
    });
    socket.on('error', () => {});
  });
  if (process.platform !== 'win32') {
    try {
      const stale = await lstat(path);
      if (!stale.isSocket())
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Runner socket path contains a non-socket file',
        );
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') await chmod(path, 0o600);
  runner.onStopAdmission(async () => {
    stopping = true;
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    await queue;
    for (const socket of sockets) socket.destroy();
    await closed;
    if (process.platform !== 'win32') await unlink(path).catch(() => {});
  });
  return server;
}
export function rpcCall(
  method: string,
  params: Record<string, unknown> = {},
  path = socketPath(),
  timeoutMs = 15_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = 1;
    const socket = createConnection(path);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () =>
      socket.destroy(
        new AgentCliError(
          'NETWORK_ERROR',
          'Runner timed out; reconcile exchange state before retry',
        ),
      ),
    );
    socket.once('connect', () =>
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      ),
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_RPC_BYTES) {
        socket.destroy(new Error('Oversize runner response'));
        return;
      }
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (response.jsonrpc !== '2.0' || response.id !== id)
          throw new Error('Invalid runner response');
        if (response.error) {
          const error = response.error.data;
          reject(
            new AgentCliError(
              error.code,
              error.message,
              error.details,
              error.retryable,
            ),
          );
        } else resolve(response.result);
        socket.end();
      } catch (error) {
        reject(error);
        socket.destroy();
      }
    });
    socket.once('error', (error) =>
      reject(
        error instanceof AgentCliError
          ? error
          : new AgentCliError(
              ['ENOENT', 'ECONNREFUSED'].includes(
                (error as NodeJS.ErrnoException).code ?? '',
              )
                ? 'RUNNER_NOT_RUNNING'
                : 'NETWORK_ERROR',
              error.message,
            ),
      ),
    );
    socket.once('end', () => {
      if (!buffer.includes('\n'))
        reject(
          new AgentCliError(
            'NETWORK_ERROR',
            'Runner disconnected; reconcile exchange state',
          ),
        );
    });
  });
}
export async function routeToRunner(
  name: string,
  input: Record<string, unknown>,
  context: Context,
) {
  if (context.runner || !routedCommands.has(name))
    return { routed: false as const };
  const config = await loadConfig(context.configPath);
  const mode = await resolveMode(context, name);
  // Paper commands always execute locally against the paper store; they must
  // never be routed to a live runner (or vice versa).
  if (mode === 'paper') return { routed: false as const };
  try {
    return {
      routed: true as const,
      data: await rpcCall(
        name,
        {
          ...input,
          __context: {
            configPath: context.configPath ?? join(stateDir(), 'config.json'),
            network: context.network ?? config.network,
            mode,
          },
        },
        socketPath(),
      ),
    };
  } catch (error) {
    if (
      error instanceof AgentCliError &&
      error.code === 'RUNNER_NOT_RUNNING' &&
      config.runnerFallback &&
      !(await runningInfo())
    )
      return { routed: false as const };
    if (
      error instanceof AgentCliError &&
      error.code === 'NETWORK_ERROR' &&
      ['order', 'cancel', 'modify', 'leverage', 'rotate', 'revoke'].includes(
        name,
      )
    ) {
      const details =
        error.details && typeof error.details === 'object'
          ? (error.details as Record<string, unknown>)
          : {};
      throw new AgentCliError(
        'NETWORK_ERROR',
        error.message,
        {
          ...details,
          outcome: 'unknown',
          cloid: details.cloid ?? input.cloid ?? null,
          intentId: input.intentId ?? null,
        },
        false,
      );
    }
    throw error;
  }
}
