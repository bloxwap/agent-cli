import { expect, test } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from '../src/commands/skill.js';
import { skillContent, cliVersion } from '../src/core/skill-content.js';
import packageInfo from '../package.json' with { type: 'json' };
import { commands, dispatch, setRouting } from '../src/core/router.js';
import { errorDefaults } from '../src/errors/index.js';
import '../src/commands/config.js';
import '../src/commands/init.js';
import '../src/commands/fund.js';
import '../src/commands/deposit.js';
import '../src/commands/read.js';
import '../src/commands/order.js';
import '../src/commands/cancel.js';
import '../src/commands/modify.js';
import '../src/commands/leverage.js';
import '../src/commands/run.js';
import '../src/commands/events.js';
import '../src/commands/logs.js';
import '../src/commands/rotate.js';
import '../src/commands/revoke.js';
import '../src/commands/audit.js';
import '../src/commands/skill.js';
import '../src/commands/market.js';
import '../src/commands/paper.js';

test('skill frontmatter and embedded source match the published skill', async () => {
  const source = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  expect(source).toBe(skillContent);
  const frontmatter = source.match(/^---\n([\s\S]+?)\n---\n/);
  expect(frontmatter).not.toBeNull();
  expect(frontmatter![1]).toMatch(/^name: agent-cli$/m);
  expect(frontmatter![1]).toMatch(/^description: [^\n:]+$/m);
  expect(frontmatter![1]).toContain(`  version: "${packageInfo.version}"`);
  expect(source).toContain(`"version":"${packageInfo.version}"`);
  for (const code of Object.keys(errorDefaults)) expect(source).toContain(code);
  for (const required of [
    '8 decimals', '6', 'two distinct signatures', '180 days',
    'own Privy account and app', 'Bloxwap does not', 'external wallet',
    'never be reported as live validation',
  ]) expect(source).toContain(required);
});

test('every documented command example parses through the real CLI schemas offline', async () => {
  // Route after validation: this tests the exact documented inputs without
  // creating wallets, signing, connecting to a service or mutating user state.
  const covered = new Set<string>();
  const table = skillContent.split('## Commands and example envelopes')[1]
    .split('## Error recovery')[0];
  setRouting(async () => ({ routed: true, data: {} }));
  try {
    for (const line of table.split('\n').filter((line) => line.startsWith('| `'))) {
      const separator = line.indexOf(' | ');
      const inputCell = line.slice(0, separator);
      const outputCell = line.slice(separator + 3);
      for (const [, example] of inputCell.matchAll(/`([^`]+)`/g)) {
        const argv = [...example.replaceAll('0x...', '0x' + 'a'.repeat(40))
          .matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)]
          .map((match) => match[1] ?? match[2] ?? match[3]);
        const result = await dispatch(argv);
        expect(result.body, example).toMatchObject({ ok: true });
        covered.add(argv[0]);
      }
      const exampleOutput = outputCell.match(/`([^`]+)`/)![1];
      expect(() => JSON.parse(exampleOutput), line).not.toThrow();
    }
    expect([...commands.keys()].filter((name) => !covered.has(name))).toEqual([]);
    expect(covered).toContain('--help');
    expect(covered).toContain('schema');
  } finally {
    setRouting(undefined);
  }
});

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
