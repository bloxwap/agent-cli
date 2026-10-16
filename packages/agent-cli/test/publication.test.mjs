import { expect, test, vi } from 'vitest';
import {
  readRegistryDist,
  verifyPublication,
} from '../scripts/publication.mjs';

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
test('an existing version must match the tested archive and have provenance', () => {
  expect(() =>
    verifyPublication({ integrity: 'sha512-other' }, 'sha512-example'),
  ).toThrow('differs');
  expect(() =>
    verifyPublication({ integrity: 'sha512-example' }, 'sha512-example'),
  ).toThrow('provenance');
  expect(() => verifyPublication(undefined, 'sha512-example')).toThrow(
    'differs',
  );
});
