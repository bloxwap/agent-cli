import { expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  npmPublishArgs,
  readRegistryDist,
  verifyPublication,
} from '../scripts/publication.mjs';
import {
  assertCollaboratorWrite,
  readPublishToken,
  verifyPublishAuth,
} from '../scripts/check-publish-auth.mjs';

test('only an explicit npm registry 404 is treated as an unpublished version', () => {
  const missing = vi.fn(() => {
    throw Object.assign(new Error('npm404'), {
      stdout: JSON.stringify({ error: { code: 'E404' } }),
    });
  });
  expect(readRegistryDist('@bloxwap/agent-cli@0.2.0', missing)).toBeUndefined();
  for (const code of ['E401', 'E403', 'ENOTFOUND', 'ETIMEDOUT']) {
    const fail = () => {
      throw Object.assign(new Error(code), {
        stdout: JSON.stringify({ error: { code } }),
      });
    };
    expect(() => readRegistryDist('@bloxwap/agent-cli@0.2.0', fail)).toThrow(
      code,
    );
  }
});
test('invalid registry output and subprocess failures stop publication', () => {
  expect(() => readRegistryDist('package', () => 'bad JSON')).toThrow();
  expect(() =>
    readRegistryDist('package', () => {
      throw new Error('subprocess');
    }),
  ).toThrow('subprocess');
});
test('registry distribution is parsed without changing its integrity', () => {
  const dist = {
    integrity: 'sha512-example',
    attestations: { url: 'https://registry.npmjs.org/attestations/example' },
  };
  expect(readRegistryDist('package', () => JSON.stringify(dist))).toEqual(dist);
  expect(() => verifyPublication(dist, 'sha512-example')).not.toThrow();
});
test('an existing version must match the tested archive', () => {
  expect(() =>
    verifyPublication({ integrity: 'sha512-other' }, 'sha512-example'),
  ).toThrow('differs');
  expect(() =>
    verifyPublication({ integrity: 'sha512-example' }, 'sha512-example'),
  ).not.toThrow();
  expect(() => verifyPublication(undefined, 'sha512-example')).toThrow(
    'differs',
  );
});
test('token publish does not request npm provenance', () => {
  expect(npmPublishArgs('release.tgz')).toEqual([
    'publish',
    'release.tgz',
    '--access',
    'public',
    '--ignore-scripts',
  ]);
  expect(npmPublishArgs('release.tgz')).not.toContain('--provenance');
});
test('publish auth fails closed without a token and does not print secrets', () => {
  expect(() =>
    readPublishToken({ NODE_AUTH_TOKEN: '', NPM_TOKEN: '' }),
  ).toThrow('NPM_TOKEN is missing');
  const script = fileURLToPath(
    new URL('../scripts/check-publish-auth.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '' },
  });
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/NPM_TOKEN is missing/);
  expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
    /npm_[A-Za-z0-9]{8,}/,
  );
});
test('publish auth accepts write access and first-publish 404 without network', async () => {
  assertCollaboratorWrite('@bloxwap/agent-cli', 'ci-bot', {
    'ci-bot': 'write',
  });
  expect(() =>
    assertCollaboratorWrite('@bloxwap/agent-cli', 'ci-bot', {
      'ci-bot': 'read',
    }),
  ).toThrow('cannot publish');

  const ok = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const firstPublish = await verifyPublishAuth({
    token: 'npm_testtoken',
    name: '@bloxwap/agent-cli',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/-/whoami'))
        return ok({ username: 'bloxwap-ci' });
      return ok({}, 404);
    },
  });
  expect(firstPublish.unpublished).toBe(true);
  expect(firstPublish.message).toMatch(/not on the registry yet/);

  const published = await verifyPublishAuth({
    token: 'npm_testtoken',
    name: '@bloxwap/agent-cli',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/-/whoami'))
        return ok({ username: 'bloxwap-ci' });
      return ok({ 'bloxwap-ci': 'read-write' });
    },
  });
  expect(published.unpublished).toBe(false);

  await expect(
    verifyPublishAuth({
      token: 'npm_testtoken',
      name: '@bloxwap/agent-cli',
      fetchImpl: async () => ok({}, 401),
    }),
  ).rejects.toThrow('npm token authentication failed');
});
