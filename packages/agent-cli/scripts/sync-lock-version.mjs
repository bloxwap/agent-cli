import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
// bun install --lockfile-only (the next step in version:packages) writes the
// workspace version into bun.lock. The deleted package-lock.json is no longer
// a source of truth for the published package version.
console.log(`@bloxwap/agent-cli@${manifest.version}: bun.lock will be updated by bun install --lockfile-only`);
