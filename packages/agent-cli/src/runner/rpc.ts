import { assertSafeInput } from '../wallet/safety.js';
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from 'node:net';
import { chmod, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { stateDir, loadConfig } from '../core/config.js';
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
const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
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
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1_048_576) {
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        queue = queue
          .then(async () => {
            let id: unknown = null;
            try {
              if (stopping)
                throw new AgentCliError(
                  'RUNNER_NOT_RUNNING',
                  'Runner stopping',
                );
              const request = requestSchema.parse(JSON.parse(line));
              id = request.id;
              const metadata = request.params.__context as
                { configPath?: string; network?: string } | undefined;
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
                    { ...context, runner: true },
                  );
              socket.write(
                JSON.stringify({ jsonrpc: '2.0', id, result: data }) + '\n',
              );
            } catch (error) {
              const normalized =
                error instanceof SyntaxError || error instanceof z.ZodError
                  ? new AgentCliError(
                      'CONFIG_INVALID',
                      'Invalid JSON-RPC request',
                    )
                  : normalizeError(error);
              socket.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32000,
                    message: normalized.message,
                    data: normalized.toJSON(),
                  },
                }) + '\n',
              );
            }
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
  runner.onShutdown(async () => {
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
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = 1;
    const socket = createConnection(path);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(15_000, () =>
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
      if (buffer.length > 1_048_576) {
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
  try {
    return {
      routed: true as const,
      data: await rpcCall(name, {
        ...input,
        __context: {
          configPath: context.configPath ?? join(stateDir(), 'config.json'),
          network: context.network ?? config.network,
        },
      }),
    };
  } catch (error) {
    if (
      error instanceof AgentCliError &&
      error.code === 'RUNNER_NOT_RUNNING' &&
      config.runnerFallback &&
      !(await runningInfo())
    )
      return { routed: false as const };
    throw error;
  }
}
