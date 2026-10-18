import { expect, test } from 'vitest';
import { smokeInvocation } from '../scripts/binary-smoke.mjs';

test('docker platform wraps the binary for a Colima linux container', () => {
  expect(
    smokeInvocation('/opt/agent-cli-linux-x64', ['--help'], {
      BLOXWAP_SMOKE_DOCKER_PLATFORM: 'linux/amd64',
    }),
  ).toEqual({
    file: 'docker',
    argv: [
      'run',
      '--rm',
      '--platform',
      'linux/amd64',
      '-v',
      '/opt/agent-cli-linux-x64:/opt/agent-cli:ro',
      'debian:bookworm-slim',
      '/opt/agent-cli',
      '--help',
    ],
  });
});

test('Rosetta wraps the darwin-x64 binary with arch -x86_64', () => {
  expect(
    smokeInvocation('/opt/agent-cli-darwin-x64', ['schema', 'order'], {
      BLOXWAP_SMOKE_ROSETTA: '1',
    }),
  ).toEqual({
    file: 'arch',
    argv: ['-x86_64', '/opt/agent-cli-darwin-x64', 'schema', 'order'],
  });
});

test('native invocation runs the binary directly', () => {
  expect(smokeInvocation('/opt/agent-cli-darwin-arm64', ['--help'])).toEqual({
    file: '/opt/agent-cli-darwin-arm64',
    argv: ['--help'],
  });
});
