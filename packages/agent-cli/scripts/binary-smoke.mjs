import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const binary = resolve(
  process.argv[2] ?? `binaries/agent-cli-${process.platform}-${process.arch}`,
);
const run = (args) =>
  JSON.parse(
    execFileSync(binary, args, {
      input: '',
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );
assert.equal(run(['--help']).ok, true);
const order = run(['schema', 'order']);
assert.equal(order.ok, true);
assert.ok(order.data.input.properties.coin);
console.log(
  `PASS: standalone ${process.platform}/${process.arch} CLI help and order schema`,
);
