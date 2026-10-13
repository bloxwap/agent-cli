import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { register } from '../core/router.js';
import { atomicWrite } from '../core/config.js';
import { cliVersion, skillContent } from '../core/skill-content.js';
import { AgentCliError } from '../errors/index.js';
export async function installSkill(
  target: 'claude' | 'codex',
  options: { home?: string; codexHome?: string; force?: boolean } = {},
) {
  const home = options.home ?? homedir();
  const root =
    target === 'codex'
      ? (options.codexHome ?? process.env.CODEX_HOME ?? join(home, '.codex'))
      : join(home, '.claude');
  const path = join(root, 'skills', 'agent-cli', 'SKILL.md');
  try {
    const existing = await readFile(path, 'utf8');
    if (existing === skillContent)
      return { target, path, version: cliVersion, changed: false };
    if (!options.force)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Skill already exists with different content; use --force to replace',
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWrite(path, skillContent);
  return { target, path, version: cliVersion, changed: true };
}
register('skill', {
  description:
    'Install packaged version-matched skill for Claude Code or Codex',
  schema: z.object({
    args: z.array(z.string()).default(['install']),
    target: z.enum(['claude', 'codex']).default('codex'),
    force: z.boolean().default(false),
  }),
  execute: async (input) => {
    if ((input.args as string[])[0] !== 'install')
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Use skill install --target claude|codex',
      );
    return installSkill(input.target as 'claude' | 'codex', {
      force: input.force as boolean,
    });
  },
});
