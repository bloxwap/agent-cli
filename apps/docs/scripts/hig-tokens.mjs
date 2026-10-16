// Verifies the HIG package install: vendored candidate tarballs match their recorded hashes, the docs and the root
// overrides depend on exactly those files, the installed packages are the same build, and app/global.css reads HIG
// values through --hig-* roles instead of copying token numbers or bridging font families.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { tokens } from '@bloxwap/hig-tokens';
import { assertNoCopiedHigTokens } from './hig-css-guard.mjs';

const root = new URL('../../../', import.meta.url);
const docs = new URL('../', import.meta.url);
const vendor = new URL('vendor/bloxwap-hig/', root);
const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('package.json', docs), 'utf8'));
const workspace = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
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
  const spec = manifest.dependencies[name] ?? manifest.devDependencies?.[name];
  assert.equal(spec, `file:../../vendor/bloxwap-hig/${file}`, `${name} must install from vendor/bloxwap-hig/${file}`);
  if (name in (workspace.overrides ?? {})) {
    assert.equal(workspace.overrides[name], `file:./vendor/bloxwap-hig/${file}`, `root override for ${name} must point at vendor/bloxwap-hig/${file}`);
  }
  const installed = await installedManifest(name);
  assert.equal(installed.version, provenance.version, `${name}: installed ${installed.version}, vendored ${provenance.version}; run npm install`);
}
assert.equal(tokens.version, provenance.version.split('-')[0]);

const css = await readFile(new URL('app/global.css', docs), 'utf8');
// Radius, motion, type, density and font families are CSS roles in @bloxwap/hig-tokens/css; a host copy would drift.
assertNoCopiedHigTokens(css);
assert.ok(!/var\(--font-bloxwap-(?:sans|mono)\)/.test(css), 'app/global.css must read fonts through --hig-font-sans/--hig-font-mono');
assert.ok(!/\.hig-(?:button|number)[^{]*\{[^}]*font-family/.test(css), 'HIG controls resolve the font roles themselves; no font-family bridge');
const roles = ['--hig-radius-xl', '--hig-motion-duration-fast', '--hig-type-body-size', '--hig-density-compact-control', '--hig-font-sans'];
const tokenCss = await readFile(new URL(import.meta.resolve('@bloxwap/hig-tokens/css')), 'utf8');
for (const role of roles) assert.ok(tokenCss.includes(`${role}:`), `installed @bloxwap/hig-tokens/css must define ${role}`);
// Every role the host reads must exist in the installed HIG CSS, so a renamed or misspelled role fails here, not visually.
const reactCss = await readFile(new URL(import.meta.resolve('@bloxwap/hig-react/css')), 'utf8');
for (const [, role] of css.matchAll(/var\((--hig-[\w-]+)/g)) {
  assert.ok(tokenCss.includes(`${role}:`) || reactCss.includes(`${role}:`), `app/global.css reads ${role}, which HIG does not define`);
}

// The copied HIG folder, alias layer and committed fonts must not come back.
for (const path of ['vendor/hig', 'styles', 'fonts']) {
  await assert.rejects(stat(new URL(path, docs)), `apps/docs/${path} must not exist; use the HIG packages`);
}
assert.ok(!/--bloxwap-[\w-]+\s*:/.test(css), 'app/global.css must not define --bloxwap-* aliases; use --hig-* roles');
console.log(`HIG ${provenance.version}: ${provenance.artifacts.length} vendored tarballs, installed packages and HIG role usage verified.`);
