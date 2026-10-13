import { readFileSync, writeFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const content = readFileSync('SKILL.md', 'utf8');
if (!content.includes(`  version: "${version}"`))
  throw new Error('Skill version differs from CLI');
writeFileSync(
  'src/core/skill-content.ts',
  `// Generated from SKILL.md and package.json.\nexport const cliVersion=${JSON.stringify(version)};\nexport const skillContent=${JSON.stringify(content)};\n`,
);
