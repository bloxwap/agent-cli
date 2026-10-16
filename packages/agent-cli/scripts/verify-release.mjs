import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseMetadata } from './release-metadata.mjs';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(packageRoot, '../..');
const tag = process.env.GITHUB_REF?.startsWith('refs/tags/')
  ? process.env.GITHUB_REF.slice('refs/tags/'.length)
  : undefined;
const release = verifyReleaseMetadata({
  manifest: JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
  ),
  lockVersion: JSON.parse(
    readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
  ).packages['packages/agent-cli'].version,
  skill: readFileSync(resolve(packageRoot, 'SKILL.md'), 'utf8'),
  changelog: readFileSync(resolve(packageRoot, 'CHANGELOG.md'), 'utf8'),
  tag,
  changesets: readdirSync(resolve(root, '.changeset'))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort(),
});
if (tag) {
  // fetch-depth: 0 must expose origin/main. Tags outside reviewed main cannot publish.
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], {
    cwd: root,
  });
  execFileSync('git', ['diff', '--exit-code', 'HEAD'], {
    cwd: root,
    stdio: 'inherit',
  });
}
console.log(
  JSON.stringify({
    ...release,
    mode: tag ? 'tagged-release' : 'candidate-only',
  }),
);
