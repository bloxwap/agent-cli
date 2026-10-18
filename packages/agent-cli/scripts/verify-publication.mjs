import {
  readRegistryDist,
  releaseArtifact,
  verifyPublication,
} from './publication.mjs';

const artifact = releaseArtifact(process.argv[2] ?? 'release');
let failure;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    verifyPublication(readRegistryDist(artifact.spec), artifact.integrity);
    console.log(
      `PASS: ${artifact.spec} registry integrity`,
    );
    failure = undefined;
    break;
  } catch (error) {
    failure = error;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
if (failure) throw failure;
