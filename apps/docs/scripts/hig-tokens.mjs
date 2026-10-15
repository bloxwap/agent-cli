// Verifies the HIG package install: vendored candidate tarballs match their recorded hashes, the docs depend on
// exactly those files, the installed packages are the same build, and the few JS-only HIG numbers that
// app/global.css copies (radius, motion, type, density) still equal the installed @bloxwap/hig-tokens.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { tokens } from '@bloxwap/hig-tokens';

const root = new URL('../../../', import.meta.url);
const docs = new URL('../', import.meta.url);
const vendor = new URL('vendor/bloxwap-hig/', root);
const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('package.json', docs), 'utf8'));
/** npm workspaces install a package in apps/docs/node_modules or hoist it to the root. */
async function installedManifest(name) {
  for (const base of [docs, root]) {
    try { return JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, base), 'utf8')); } catch { /* try the next location */ }
  }
  throw new Error(`${name} is not installed; run npm install`);
}

for (const { package: name, file, sha256 } of provenance.artifacts) {
  const digest = createHash('sha256').update(await readFile(new URL(file, vendor))).digest('hex');
  assert.equal(digest, sha256, `Vendored HIG tarball changed: ${file}`);
  assert.equal(manifest.dependencies[name], `file:../../vendor/bloxwap-hig/${file}`, `${name} must install from vendor/bloxwap-hig/${file}`);
  const installed = await installedManifest(name);
  assert.equal(installed.version, provenance.version, `${name}: installed ${installed.version}, vendored ${provenance.version}; run npm install`);
}
assert.equal(tokens.version, provenance.version.split('-')[0]);

const css = await readFile(new URL('app/global.css', docs), 'utf8');
const px = (value) => `${value}px`;
const rem = (value) => `${value / 16}rem`;
const expected = {
  '--docs-radius': px(tokens.radius.xl),
  '--docs-radius-pill': px(tokens.radius.pill),
  '--docs-duration': `${tokens.motion.fast}ms`,
  '--docs-control-compact': px(tokens.density.compact.control),
  '--docs-control-touch': px(tokens.density.comfortable.control),
  '--docs-type-caption': rem(tokens.type.caption.size),
  '--docs-type-body': rem(tokens.type.body.size),
  '--docs-type-body-line': rem(tokens.type.body.lineHeight),
  '--docs-type-title': rem(tokens.type.title.size),
  '--docs-type-title-line': rem(tokens.type.title.lineHeight),
  '--docs-type-display': rem(tokens.type.display.size),
  '--docs-type-weight': String(tokens.type.title.weight),
};
assert.equal(tokens.type.display.weight, tokens.type.title.weight, '--docs-type-weight serves both title and display');
for (const [name, value] of Object.entries(expected)) {
  const match = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
  assert.equal(match?.[1].trim(), value, `app/global.css ${name} must equal @bloxwap/hig-tokens (${value})`);
}

// The copied HIG folder, alias layer and committed fonts must not come back.
for (const path of ['vendor/hig', 'styles', 'fonts']) {
  await assert.rejects(stat(new URL(path, docs)), `apps/docs/${path} must not exist; use the HIG packages`);
}
assert.ok(!/--bloxwap-[\w-]+\s*:/.test(css), 'app/global.css must not define --bloxwap-* aliases; use --hig-* roles');
console.log(`HIG ${provenance.version}: ${provenance.artifacts.length} vendored tarballs, installed packages and ${Object.keys(expected).length} host token values verified.`);
