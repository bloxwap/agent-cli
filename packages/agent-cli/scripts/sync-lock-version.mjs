import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const lockfile = new URL('../../../package-lock.json', import.meta.url);
const lock = JSON.parse(readFileSync(lockfile, 'utf8'));
const workspace = lock.packages['packages/agent-cli'];
assert.equal(workspace.name, manifest.name, 'Unexpected lockfile workspace');
// Versioning changes no resolutions: preserve all dependencies and platform entries.
workspace.version = manifest.version;
writeFileSync(lockfile, `${JSON.stringify(lock, null, 2)}\n`);
