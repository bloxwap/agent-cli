import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync('binaries', { recursive: true });
const targets = process.argv.slice(2);
for (const target of targets.length
  ? targets
  : ['bun-linux-x64', 'bun-darwin-arm64'])
  execFileSync(
    'bun',
    [
      'build',
      'src/cli.ts',
      '--compile',
      `--target=${target}`,
      '--outfile',
      `binaries/agent-cli-${target.replace('bun-', '')}`,
    ],
    { stdio: 'inherit' },
  );
