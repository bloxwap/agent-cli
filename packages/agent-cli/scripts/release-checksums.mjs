import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release');
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS')
  .map((entry) => entry.name)
  .sort();
for (const required of [
  'agent-cli-linux-x64',
  'agent-cli-linux-arm64',
  'agent-cli-darwin-x64',
  'agent-cli-darwin-arm64',
  'SKILL.md',
  'CHANGELOG.md',
  'LICENSE',
])
  assert.ok(files.includes(required), `Missing release artifact: ${required}`);
assert.equal(
  files.filter((file) => file.endsWith('.tgz')).length,
  1,
  'Expected exactly one npm tarball',
);
writeFileSync(
  join(directory, 'SHA256SUMS'),
  files
    .map(
      (file) =>
        `${createHash('sha256')
          .update(readFileSync(join(directory, file)))
          .digest('hex')}  ${file}\n`,
    )
    .join(''),
);
console.log(`Prepared SHA256SUMS for ${files.length} release artifacts`);
