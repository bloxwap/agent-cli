import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function releaseArtifact(directory) {
  const root = resolve(directory);
  const tarballs = readdirSync(root).filter((file) => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'Expected exactly one published tarball');
  const tarball = join(root, tarballs[0]);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  return { tarball, integrity, spec: `${manifest.name}@${manifest.version}` };
}

export function readRegistryDist(spec, run = execFileSync) {
  let output;
  try {
    output = run('npm', ['view', spec, 'dist', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (error) {
    // Only an explicit registry 404 means unpublished. Authentication/network errors stop release.
    let response;
    try {
      response = JSON.parse(String(error.stdout));
    } catch {
      throw error;
    }
    if (response?.error?.code === 'E404') return undefined;
    throw error;
  }
  return JSON.parse(output);
}

export function verifyPublication(dist, integrity) {
  assert.equal(
    dist?.integrity,
    integrity,
    'Published tarball differs from tested release artifact',
  );
  assert.ok(dist?.attestations?.url, 'npm provenance attestation is missing');
}
