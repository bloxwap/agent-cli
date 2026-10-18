import { execFileSync } from 'node:child_process';
import {
  npmPublishArgs,
  readRegistryDist,
  releaseArtifact,
  verifyPublication,
} from './publication.mjs';

const artifact = releaseArtifact(process.argv[2] ?? 'release');
const published = readRegistryDist(artifact.spec);
if (published) {
  verifyPublication(published, artifact.integrity);
  console.log(
    `Already published identical artifact: ${artifact.spec}; continuing release`,
  );
} else {
  execFileSync('npm', npmPublishArgs(artifact.tarball), { stdio: 'inherit' });
}
