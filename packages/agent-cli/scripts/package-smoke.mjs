import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scratch = process.env.RUNNER_TEMP || tmpdir();
const directory = mkdtempSync(join(scratch, 'bloxwap-package-'));
const jsonCommand = (command, args, cwd = directory) =>
  JSON.parse(
    execFileSync(command, args, {
      cwd,
      input: '',
      encoding: 'utf8',
      timeout: 120_000,
    }),
  );
function smoke(command, prefix = [], cwd = directory) {
  const help = jsonCommand(command, [...prefix, '--help'], cwd);
  assert.equal(help.ok, true, 'CLI help failed');
  assert.ok(
    help.data.commands.some(({ name }) => name === 'order'),
    'Order command missing',
  );
  const schema = jsonCommand(command, [...prefix, 'schema', 'order'], cwd);
  assert.equal(schema.ok, true, 'Order schema failed');
  assert.ok(schema.data.input.properties.coin, 'Order input schema missing');
}

try {
  const registry = process.env.BLOXWAP_SMOKE_REGISTRY === '1';
  const sourceManifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const registrySpec = `${sourceManifest.name}@${sourceManifest.version}`;
  const tarball = process.env.BLOXWAP_SMOKE_TARBALL
    ? resolve(process.env.BLOXWAP_SMOKE_TARBALL)
    : join(
        directory,
        jsonCommand(
          'npm',
          [
            'pack',
            ...(registry ? [registrySpec] : []),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            directory,
          ],
          process.cwd(),
        )[0].filename,
      );
  execFileSync('tar', ['-xzf', tarball, '-C', directory]);
  const packedRoot = join(directory, 'package');
  const manifest = JSON.parse(
    readFileSync(join(packedRoot, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.name, '@bloxwap/agent-cli');
  assert.equal(manifest.bin['agent-cli'], 'dist/cli.js');
  for (const lifecycle of ['preinstall', 'install', 'postinstall'])
    assert.equal(
      manifest.scripts?.[lifecycle],
      undefined,
      `Unexpected ${lifecycle} script`,
    );
  for (const required of [
    'SKILL.md',
    'dist/cli.js',
    'policies/agent-trade-only.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
  ])
    assert.ok(
      statSync(join(packedRoot, required)).isFile(),
      `Package missing ${required}`,
    );
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.ok(
    !files.some((file) =>
      /^package\/(apps|src|test|scripts|node_modules)\//.test(file),
    ),
    'Package includes development files',
  );
  const cli = readFileSync(join(packedRoot, 'dist/cli.js'), 'utf8');
  assert.ok(
    cli.startsWith('#!/usr/bin/env node\n'),
    'CLI must have a Node shebang',
  );
  if (process.platform !== 'win32')
    assert.ok(
      statSync(join(packedRoot, 'dist/cli.js')).mode & 0o111,
      'CLI must be executable',
    );
  assert.ok(
    readFileSync(join(packedRoot, 'SKILL.md'), 'utf8').includes(
      `  version: "${manifest.version}"`,
    ),
    'Packaged skill version differs',
  );

  const globalRoot = join(directory, 'global');
  execFileSync(
    'npm',
    [
      'install',
      '--global',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefix',
      globalRoot,
      registry ? registrySpec : tarball,
    ],
    { cwd: directory, stdio: 'pipe', timeout: 180_000 },
  );
  const bin =
    process.platform === 'win32'
      ? join(globalRoot, 'agent-cli.cmd')
      : join(globalRoot, 'bin', 'agent-cli');
  smoke(bin);

  if (process.env.BLOXWAP_SMOKE_BUN === '1') {
    if (registry) {
      // Run from outside any project to exercise bunx's public registry auto-install path.
      smoke('bun', ['x', registrySpec]);
      smoke('bun', ['x', '--bun', registrySpec]);
    }
    const fixture = join(directory, 'bun-consumer');
    mkdirSync(fixture);
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 'agent-cli-install-smoke', private: true }),
    );
    execFileSync(
      'bun',
      ['add', '--ignore-scripts', registry ? registrySpec : tarball],
      {
        cwd: fixture,
        stdio: 'pipe',
        timeout: 180_000,
      },
    );
    // Resolve the installed tarball through bunx, without falling back to source or the registry.
    smoke('bun', ['x', '--no-install', '@bloxwap/agent-cli'], fixture);
    smoke('bun', ['x', '--bun', '--no-install', '@bloxwap/agent-cli'], fixture);
  }
  console.log(
    `PASS: @bloxwap/agent-cli@${manifest.version} tarball, script-free global install, help/schema${process.env.BLOXWAP_SMOKE_BUN === '1' ? ', installed bunx with Node and Bun' : ''}`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
