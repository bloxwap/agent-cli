import assert from 'node:assert/strict';

export function assertNoCopiedHigTokens(css) {
  // A declaration can follow another declaration or an opening brace on the same line.
  const copied = css.match(/(?:^|[;{\s])(--docs-(?:radius|duration|ease|control|type)[\w-]*\s*:)/m);
  assert.ok(!copied, `app/global.css must use --hig-radius/motion/type/density roles, not copy ${copied?.[1]}`);
}
