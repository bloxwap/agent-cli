import { describe, expect, test } from 'vitest';
import { verifyReleaseMetadata } from '../scripts/release-metadata.mjs';

const candidate = () => ({
  manifest: {
    name: '@bloxwap/agent-cli',
    version: '0.2.0',
    repository: { url: 'git+https://github.com/bloxwap/agent-cli.git' },
  },
  skill: '---\nmetadata:\n  version: "0.2.0"\n---\n',
  changelog: '# @bloxwap/agent-cli\n\n## 0.2.0\n\nChanges.\n',
  tag: 'v0.2.0',
  lockVersion: '0.2.0',
});
describe('release metadata gate', () => {
  test('accepts a matching versioned stable release', () => {
    expect(verifyReleaseMetadata(candidate())).toEqual({
      name: '@bloxwap/agent-cli',
      version: '0.2.0',
      tag: 'v0.2.0',
    });
  });
  test('rejects a mismatched tag', () => {
    expect(() =>
      verifyReleaseMetadata({ ...candidate(), tag: 'v0.1.0' }),
    ).toThrow('Tag/version mismatch');
  });
  test('rejects a stale lockfile version', () => {
    expect(() =>
      verifyReleaseMetadata({ ...candidate(), lockVersion: '0.1.0' }),
    ).toThrow('Lockfile version differs');
  });
  test('rejects unpublished changesets on a release tag', () => {
    expect(() =>
      verifyReleaseMetadata({ ...candidate(), changesets: ['fix.md'] }),
    ).toThrow('Version the pending changesets');
  });
  test('allows pending changesets in candidate-only mode', () => {
    expect(
      verifyReleaseMetadata({
        ...candidate(),
        tag: undefined,
        changesets: ['fix.md'],
      }).tag,
    ).toBeNull();
  });
  test('rejects a stale packaged skill', () => {
    expect(() =>
      verifyReleaseMetadata({
        ...candidate(),
        skill: 'metadata:\n  version: "0.1.0"',
      }),
    ).toThrow('Skill version differs');
  });
  test('requires versioned release notes', () => {
    expect(() =>
      verifyReleaseMetadata({
        ...candidate(),
        changelog: '# Changelog\n## 0.1.0\n',
      }),
    ).toThrow('missing from CHANGELOG');
  });
  test('refuses a prerelease rather than publishing it to latest', () => {
    const fixture = candidate();
    fixture.manifest.version = '0.2.0-rc.1';
    expect(() => verifyReleaseMetadata(fixture)).toThrow('Only stable semver');
  });
  test('requires correct public provenance source metadata', () => {
    const fixture = candidate();
    fixture.manifest.repository.url = 'git+https://github.com/other/repo.git';
    expect(() => verifyReleaseMetadata(fixture)).toThrow('provenance source');
  });
});
