import { readFileSync, writeFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const skill = readFileSync('SKILL.md', 'utf8');
writeFileSync(
  'SKILL.md',
  skill
    .replace(/(metadata:\n  version: )"[^"]+"/, `$1"${version}"`)
    .replace(/("version":")\d+\.\d+\.\d+(")/g, `$1${version}$2`),
);
