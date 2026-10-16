import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../../packages/agent-cli/dist/cli.js', import.meta.url));
const invoke = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { input: '', encoding: 'utf8' })).data;
const pages = new URL('../content/docs/', import.meta.url);
let commands = '---\ntitle: Command reference\ndescription: Every registered command, with input and output schemas from the CLI.\n---\n\n';
commands += 'Generated from `agent-cli --help` and `agent-cli schema COMMAND`. Do not edit by hand.\n\n';
commands += 'Global flags: `--config PATH`, `--network mainnet|testnet`, `--pretty`, `--json OBJECT`. Inputs accept flags, JSON arguments, or a JSON object on stdin. Unknown object fields are rejected.\n\n';
commands += '## Help and schema\n\n```sh\nagent-cli --help\nagent-cli schema order\n```\n\nHelp lists registered commands and global flags. `schema COMMAND` returns that command\'s input and success/failure output schemas without calling a service.\n\n';
for (const command of invoke('--help').commands) {
  commands += `## ${command.name}\n\n${command.description}\n\n\`\`\`json\n${JSON.stringify(invoke('schema', command.name), null, 2)}\n\`\`\`\n\n`;
}
const skillSource = readFileSync(new URL('../../../packages/agent-cli/SKILL.md', import.meta.url), 'utf8');
const skill = '---\ntitle: Agent skill guide\ndescription: Install and use the packaged SKILL.md with Codex or Claude Code.\n---\n\n' +
  'import Link from \'next/link\';\n\n' +
  '<Link href="/SKILL.md" download="SKILL.md" prefetch={false}>Download SKILL.md</Link> as plain Markdown, including the skill frontmatter.\n\n' +
  'The npm package ships `SKILL.md` and embeds the same content in the CLI. Install it with:\n\n```sh\nagent-cli skill install --target codex\nagent-cli skill install --target claude\n```\n\nCodex uses `$CODEX_HOME/skills/agent-cli/SKILL.md` (default `~/.codex/skills/agent-cli/SKILL.md`). Claude Code uses `~/.claude/skills/agent-cli/SKILL.md`. Reinstalling identical content is idempotent; replacing edited content requires `--force`.\n\nThe following guide comes directly from the packaged skill.\n\n' + skillSource.replace(/^---\n[\s\S]*?\n---\n/, '');
for (const [name, target, text] of [
  ['commands.mdx', new URL('commands.mdx', pages), commands],
  ['skill.mdx', new URL('skill.mdx', pages), skill],
  ['public/SKILL.md', new URL('../public/SKILL.md', import.meta.url), skillSource],
]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== text) throw new Error(`${name} is stale: run npm run docs:generate`);
  } else writeFileSync(target, text);
}
console.log('Command schemas, skill guide and public SKILL.md synchronized.');
