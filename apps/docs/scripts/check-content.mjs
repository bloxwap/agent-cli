import './generate-content.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../content/docs/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', root), 'utf8'));
const files = readdirSync(root).filter((name) => name.endsWith('.mdx'));
assert.deepEqual(files.map((name) => name.slice(0, -4)).sort(), [...meta.pages].sort(), 'Every page must appear in sidebar metadata');
for (const name of files) {
  const text = readFileSync(new URL(name, root), 'utf8');
  assert.match(text, /^---\ntitle: .+\ndescription: .+\n---/);
  assert.ok(!text.includes('~/.blockswap'), `${name}: incorrect state path`);
  for (const [, slug] of text.matchAll(/\]\(\/docs\/([\w-]+)\)/g))
    assert.ok(files.includes(`${slug}.mdx`), `${name}: missing page ${slug}`);
}
console.log(`Content verified: ${files.length} pages and sidebar entries.`);
