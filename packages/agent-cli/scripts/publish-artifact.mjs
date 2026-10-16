import { execFileSync } from 'node:child_process';
import {
  readRegistryDist,
  releaseArtifact,
  verifyPublication,
} from './publication.mjs';

const artifact = releaseArtifact(process.argv[2] ?? 'release');
const published = readRegistryDist(artifact.spec);
if (published) {
  verifyPublication(published, artifact.integrity);
  console.log(
    `Already published identical provenanced artifact: ${artifact.spec}; continuing release`,
  );
} else {
  execFileSync(
    'npm',
    [
      'publish',
      artifact.tarball,
      '--provenance',
      '--access',
      'public',
      '--ignore-scripts',
    ],
    { stdio: 'inherit' },
  );
}
