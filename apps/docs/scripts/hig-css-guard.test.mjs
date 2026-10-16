import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoCopiedHigTokens } from './hig-css-guard.mjs';

test('rejects copied HIG declarations in formatted and compact CSS', () => {
  for (const css of [
    ':root {\n  --docs-radius: 14px;\n}',
    ':root { --docs-icon: 16px; --docs-radius: 14px; }',
    ':root{--docs-duration-fast:120ms;--docs-icon:16px}',
    ':root{--docs-icon:16px;--docs-ease-standard:ease}',
    ':root{--docs-control-height:32px}',
    '.compact{--docs-type-body-size:14px}',
  ]) {
    assert.throws(() => assertNoCopiedHigTokens(css), /must use --hig-radius\/motion\/type\/density roles/);
  }
});

test('allows host-specific declarations and HIG role references', () => {
  assert.doesNotThrow(() => assertNoCopiedHigTokens(`
    :root { --docs-icon: 16px; --docs-gap: 1rem; }
    .card { border-radius: var(--hig-radius-xl); font-size: var(--hig-type-body-size); }
    .icon { width: var(--docs-icon); }
  `));
});
