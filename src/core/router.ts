import { outputSchemas } from './output-schemas.js';
import { errorDefaults } from '../errors/index.js';
import { assertSafeInput } from '../wallet/safety.js';
import { auditedAction } from './audit.js';
import { z } from 'zod';
import { AgentCliError, normalizeError, success } from '../errors/index.js';
export interface Context {
  configPath?: string;
  network?: 'mainnet' | 'testnet';
  pretty: boolean;
  runner?: boolean;
  streaming?: boolean;
}
export interface Command {
  description: string;
  schema: z.ZodType;
  execute: (
    input: Record<string, unknown>,
    context: Context,
  ) => Promise<unknown>;
}
export let routing:
  | ((
      name: string,
      input: Record<string, unknown>,
      context: Context,
    ) => Promise<{ routed: boolean; data?: unknown }>)
  | undefined;
export function setRouting(value: typeof routing) {
  routing = value;
}
export const commands = new Map<string, Command>();
export function register(name: string, command: Command) {
  if (command.schema instanceof z.ZodObject)
    command = { ...command, schema: command.schema.strict() };
  if (
    ['order', 'cancel', 'modify', 'leverage', 'rotate', 'revoke'].includes(name)
  ) {
    const original = command.execute;
    command = {
      ...command,
      schema:
        command.schema instanceof z.ZodObject
          ? command.schema.extend({
              intentId: z.string().optional(),
              intent: z.string().optional(),
            })
          : command.schema,
      execute: (input, context) =>
        auditedAction(name, input, () => original(input, context)),
    };
  }
  commands.set(name, command);
}
export function schemas(name: string) {
  const command = commands.get(name);
  if (!command)
    throw new AgentCliError('CONFIG_INVALID', `Unknown command: ${name}`);
  return {
    input: z.toJSONSchema(command.schema),
    output: {
      oneOf: [
        {
          type: 'object',
          required: ['ok', 'data'],
          properties: { ok: { const: true }, data: outputSchemas[name] ?? {} },
        },
        {
          type: 'object',
          required: ['ok', 'code', 'message', 'retryable', 'details'],
          properties: {
            ok: { const: false },
            code: { enum: Object.keys(errorDefaults) },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
            details: {},
          },
        },
      ],
    },
  };
}
function parseJsonObject(value: string) {
  const parsed: unknown = JSON.parse(value);
  assertSafeInput(parsed);
  return z.record(z.string(), z.unknown()).parse(parsed);
}
function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export async function dispatch(argv: string[], stdin = '') {
  const input = Object.create(null) as Record<string, unknown>;
  const positional: string[] = [];
  const context: Context = { pretty: false };
  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--pretty') {
        context.pretty = true;
        continue;
      }
      if (arg === '--help' || arg === '-h') {
        positional.splice(0, positional.length, 'help');
        continue;
      }
      if (arg === '--config') {
        context.configPath = argv[++i];
        if (!context.configPath)
          throw new AgentCliError('CONFIG_INVALID', '--config requires a path');
        continue;
      }
      if (arg === '--network') {
        context.network = z.enum(['mainnet', 'testnet']).parse(argv[++i]);
        continue;
      }
      if (arg === '--json') {
        Object.assign(input, parseJsonObject(argv[++i]));
        continue;
      }
      if (arg.startsWith('--no-')) {
        input[
          arg.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        ] = false;
        continue;
      }
      if (arg.startsWith('--')) {
        const [flag, inline] = arg.slice(2).split('=', 2);
        const key = flag.replace(/-([a-z])/g, (_, c: string) =>
          c.toUpperCase(),
        );
        const raw =
          inline !== undefined
            ? inline
            : argv[i + 1] && !argv[i + 1].startsWith('--')
              ? argv[++i]
              : undefined;
        input[key] =
          raw === undefined
            ? true
            : [
                  'size',
                  'price',
                  'amount',
                  'triggerPrice',
                  'signature',
                  'builderSignature',
                  'cloid',
                ].includes(key)
              ? raw
              : parseValue(raw);
        continue;
      }
      positional.push(arg);
    }
    if (stdin.trim()) Object.assign(input, parseJsonObject(stdin));
    const [name = 'help', ...args] = positional;
    if (name === 'help')
      return {
        body: success({
          commands: [...commands].map(([name, c]) => ({
            name,
            description: c.description,
          })),
          globalFlags: ['--json', '--config', '--network', '--pretty'],
        }),
        exitCode: 0,
        context,
      };
    if (name === 'schema')
      return { body: success(schemas(args[0])), exitCode: 0, context };
    const command = commands.get(name);
    if (!command)
      throw new AgentCliError('CONFIG_INVALID', `Unknown command: ${name}`);
    if (args.length) input.args = args;
    assertSafeInput(input);
    const parsed = command.schema.safeParse(input);
    if (!parsed.success)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Invalid command input',
        parsed.error.flatten(),
      );
    const route = await routing?.(
      name,
      parsed.data as Record<string, unknown>,
      context,
    );
    const data = route?.routed
      ? route.data
      : await command.execute(parsed.data as Record<string, unknown>, context);
    return { body: success(data), exitCode: 0, context };
  } catch (error) {
    const normalized =
      error instanceof z.ZodError || error instanceof SyntaxError
        ? new AgentCliError('CONFIG_INVALID', 'Invalid JSON or flags')
        : normalizeError(error);
    return {
      body: normalized.toJSON(),
      exitCode: normalized.exitCode,
      context,
    };
  }
}
