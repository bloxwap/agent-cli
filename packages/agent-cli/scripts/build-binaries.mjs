import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const targets = {
  'bun-linux-x64-baseline': 'linux-x64',
  'bun-linux-arm64': 'linux-arm64',
  'bun-darwin-x64': 'darwin-x64',
  'bun-darwin-arm64': 'darwin-arm64',
};
const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(targets);
for (const target of selected)
  assert.ok(target in targets, `Unsupported binary target: ${target}`);
rmSync('binaries', { recursive: true, force: true });
mkdirSync('binaries', { recursive: true });
for (const target of selected)
  execFileSync(
    'bun',
    [
      'build',
      'src/cli.ts',
      '--compile',
      '--minify',
      '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig',
      `--target=${target}`,
      '--outfile',
      `binaries/agent-cli-${targets[target]}`,
    ],
    { stdio: 'inherit' },
  );
