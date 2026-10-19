import { z } from 'zod';
import { register } from '../core/router.js';
import { loadConfig, saveConfig, migrate } from '../core/config.js';
import { AgentCliError } from '../errors/index.js';
register('config', {
  description: 'Get, set or validate local configuration',
  schema: z.object({
    args: z.array(z.string()).default([]),
    yes: z.boolean().default(false),
  }),
  execute: async ({ args, yes }, context) => {
    const [action = 'get', key, value] = args as string[];
    const config = await loadConfig(context.configPath, {});
    if (action === 'validate') return { valid: true, version: config.version };
    if (action === 'get')
      return key
        ? (key
            .split('.')
            .reduce<unknown>(
              (v, k) => (v as Record<string, unknown>)?.[k],
              config,
            ) ?? null)
        : config;
    if (action !== 'set' || !key || value === undefined)
      throw new AgentCliError('CONFIG_INVALID', 'Use config set key value');
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
    if (
      key === 'mode' &&
      parsed === 'live' &&
      !yes &&
      config.mode !== 'live'
    )
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Switching to live mode requires explicit confirmation; re-run with --yes',
      );
    const updated = structuredClone(config) as Record<string, unknown>;
    const parts = key.split('.');
    let cursor = updated;
    for (const part of parts.slice(0, -1)) {
      if (
        !Object.hasOwn(cursor, part) ||
        !cursor[part] ||
        typeof cursor[part] !== 'object'
      )
        throw new AgentCliError('CONFIG_INVALID', 'Unknown config key');
      cursor = cursor[part] as Record<string, unknown>;
    }
    if (
      ['__proto__', 'constructor', 'prototype'].some((p) => parts.includes(p))
    )
      throw new AgentCliError('CONFIG_INVALID', 'Invalid key');
    cursor[parts.at(-1)!] = parsed;
    const validated = migrate(updated);
    await saveConfig(validated, context.configPath);
    return validated;
  },
});
