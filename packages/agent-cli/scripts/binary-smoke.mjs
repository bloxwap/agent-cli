import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function smokeInvocation(binary, args, env = process.env) {
  const platform = env.BLOXWAP_SMOKE_DOCKER_PLATFORM;
  if (platform) {
    const image = env.BLOXWAP_SMOKE_DOCKER_IMAGE || 'debian:bookworm-slim';
    return {
      file: 'docker',
      argv: [
        'run',
        '--rm',
        '--platform',
        platform,
        '-v',
        `${binary}:/opt/agent-cli:ro`,
        image,
        '/opt/agent-cli',
        ...args,
      ],
    };
  }
  if (env.BLOXWAP_SMOKE_ROSETTA === '1') {
    return { file: 'arch', argv: ['-x86_64', binary, ...args] };
  }
  return { file: binary, argv: args };
}

export function smokeBinary(binary, env = process.env) {
  const run = (args) => {
    const { file, argv } = smokeInvocation(binary, args, env);
    return JSON.parse(
      execFileSync(file, argv, {
        input: '',
        encoding: 'utf8',
        timeout: 60_000,
      }),
    );
  };
  assert.equal(run(['--help']).ok, true);
  const order = run(['schema', 'order']);
  assert.equal(order.ok, true);
  assert.ok(order.data.input.properties.coin);
  const where = env.BLOXWAP_SMOKE_DOCKER_PLATFORM
    ? env.BLOXWAP_SMOKE_DOCKER_PLATFORM
    : env.BLOXWAP_SMOKE_ROSETTA === '1'
      ? 'darwin/x64 (Rosetta)'
      : `${process.platform}/${process.arch}`;
  console.log(`PASS: standalone ${where} CLI help and order schema`);
}

const isMain =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  smokeBinary(
    resolve(
      process.argv[2] ?? `binaries/agent-cli-${process.platform}-${process.arch}`,
    ),
  );
}
