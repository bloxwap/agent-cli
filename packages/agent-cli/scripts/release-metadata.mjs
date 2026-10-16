import assert from 'node:assert/strict';

export function verifyReleaseMetadata({
  manifest,
  skill,
  changelog,
  tag,
  changesets = [],
  lockVersion,
}) {
  assert.equal(
    manifest.name,
    '@bloxwap/agent-cli',
    'Unexpected release package',
  );
  assert.match(
    manifest.version,
    /^\d+\.\d+\.\d+$/,
    'Only stable semver releases are supported',
  );
  assert.notEqual(manifest.private, true, 'Release package must be public');
  assert.equal(
    lockVersion,
    manifest.version,
    'Lockfile version differs from CLI',
  );
  assert.equal(
    manifest.repository?.url,
    'git+https://github.com/bloxwap/agent-cli.git',
    'Repository metadata must identify the provenance source',
  );
  assert.ok(
    skill.includes(`metadata:\n  version: "${manifest.version}"`),
    'Skill version differs from CLI',
  );
  assert.ok(
    changelog.split('\n').some((line) => line === `## ${manifest.version}`),
    'Package version is missing from CHANGELOG.md',
  );
  if (tag !== undefined) {
    assert.equal(tag, `v${manifest.version}`, 'Tag/version mismatch');
    assert.deepEqual(
      changesets,
      [],
      'Version the pending changesets before tagging a release',
    );
  }
  return { name: manifest.name, version: manifest.version, tag: tag ?? null };
}
