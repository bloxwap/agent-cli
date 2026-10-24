// Verifies the HIG registry install: exact dependencies and lockfile integrity match the reviewed release,
// installed packages are the same version, and app/global.css reads HIG
// values through --hig-* roles instead of copying token numbers or bridging font families.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { tokens } from '@bloxwap/hig-tokens';
import { ogFonts } from '@bloxwap/hig-og-fonts';
import { readOgFont } from '@bloxwap/hig-og-fonts/node';
import { assertNoCopiedHigTokens } from './hig-css-guard.mjs';

const root = new URL('../../../', import.meta.url);
const docs = new URL('../', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('hig-release.json', docs), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('package.json', docs), 'utf8'));
const workspace = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
/** npm workspaces install a package in apps/docs/node_modules or hoist it to the root. */
async function installedManifest(name) {
  for (const base of [docs, root]) {
    try { return JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, base), 'utf8')); } catch { /* try the next location */ }
  }
  throw new Error(`${name} is not installed; run npm install`);
}

for (const { package: name, tarball, integrity } of provenance.artifacts) {
  const spec = manifest.dependencies[name] ?? manifest.devDependencies?.[name];
  assert.equal(spec, provenance.version, `${name} must pin the reviewed registry version`);
  if (name in (workspace.overrides ?? {})) {
    assert.equal(workspace.overrides[name], provenance.version, `${name} override must pin the reviewed registry version`);
  }
  const locked = lock.packages[`apps/docs/node_modules/${name}`] ?? lock.packages[`node_modules/${name}`];
  assert.ok(locked, `${name} must be recorded in package-lock.json`);
  assert.equal(locked.version, provenance.version, `${name}: lockfile version differs from reviewed release`);
  assert.equal(locked.resolved, tarball, `${name}: lockfile must resolve the reviewed registry tarball`);
  assert.equal(locked.integrity, integrity, `${name}: lockfile integrity differs from reviewed release`);
  const installed = await installedManifest(name);
  assert.equal(installed.version, provenance.version, `${name}: installed ${installed.version}, reviewed ${provenance.version}; run npm ci`);
}
assert.equal(tokens.version, provenance.version.split('-')[0]);
assert.ok(!manifest.dependencies['@bloxwap/hig-native-fonts'] && !manifest.devDependencies?.['@bloxwap/hig-native-fonts'], 'OG cards must use the OG-only package');
await assert.rejects(stat(new URL('vendor/bloxwap-hig', root)), 'Install HIG from npm; do not restore vendored candidates');
assert.equal(provenance.ogFonts.length, 2, 'The renderer uses only the approved Bold and Black faces');
for (const face of provenance.ogFonts) {
  const descriptor = ogFonts.find(font => font.asset === face.asset);
  assert.ok(descriptor, `${face.asset} must be a packaged OG face`);
  for (const key of ['name', 'weight', 'style', 'sha256']) assert.equal(descriptor[key], face[key], `${face.asset}: ${key} must preserve the approved card face`);
  const data = await readOgFont(face.asset);
  assert.equal(data.length, face.bytes, `${face.asset}: approved byte length changed`);
  assert.equal(createHash('sha256').update(data).digest('hex'), face.sha256, `${face.asset}: approved font bytes changed`);
}

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
console.log(`HIG ${provenance.version}: ${provenance.artifacts.length} registry packages, lockfile integrity, exact OG faces and HIG role usage verified.`);
