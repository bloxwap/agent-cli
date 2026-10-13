import { expect, test } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from '../src/commands/skill.js';
import { skillContent, cliVersion } from '../src/core/skill-content.js';
import packageInfo from '../package.json' with { type: 'json' };
test('installs correct agent paths with version match and idempotency', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bloxwap-skill-'));
  try {
    expect(cliVersion).toBe(packageInfo.version);
    const codex = await installSkill('codex', {
      home,
      codexHome: join(home, 'custom-codex'),
    });
    expect(codex.path).toBe(
      join(home, 'custom-codex', 'skills', 'agent-cli', 'SKILL.md'),
    );
    expect(await readFile(codex.path, 'utf8')).toBe(skillContent);
    expect(
      (
        await installSkill('codex', {
          home,
          codexHome: join(home, 'custom-codex'),
        })
      ).changed,
    ).toBe(false);
    const claude = await installSkill('claude', { home });
    expect(claude.path).toBe(
      join(home, '.claude', 'skills', 'agent-cli', 'SKILL.md'),
    );
    await writeFile(claude.path, 'custom');
    await expect(installSkill('claude', { home })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect((await installSkill('claude', { home, force: true })).changed).toBe(
      true,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
