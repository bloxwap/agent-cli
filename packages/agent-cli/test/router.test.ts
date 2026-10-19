import { expect, test } from 'vitest';
import { z } from 'zod';
import { dispatch, register } from '../src/core/router.js';
register('echo', {
  description: 'test',
  schema: z.object({ value: z.string() }),
  execute: async (input) => input,
});
register('crash', {
  description: 'test',
  schema: z.object({}),
  execute: async () => {
    throw new Error('unexpected');
  },
});
test('flags and stdin give one success envelope', async () => {
  expect((await dispatch(['echo', '--value', 'hello'])).body).toEqual({
    ok: true,
    data: { value: 'hello' },
    mode: 'live',
    paper: false,
  });
  expect((await dispatch(['echo'], '{"value":"stdin"}')).exitCode).toBe(0);
  expect(
    (await dispatch(['echo', '--json', '{"value":"json"}'])).exitCode,
  ).toBe(0);
});
test('validation and unexpected failures normalize', async () => {
  expect((await dispatch(['echo'])).body).toMatchObject({
    ok: false,
    code: 'CONFIG_INVALID',
  });
  expect((await dispatch(['crash'])).body).toMatchObject({
    ok: false,
    code: 'INTERNAL',
  });
  expect((await dispatch(['schema', 'echo'])).exitCode).toBe(0);
});
test('output schemas expose data fields and the fixed error catalog', async () => {
  const { schemas } = await import('../src/core/router.js');
  register('balance', {
    description: 'balance',
    schema: z.object({}),
    execute: async () => ({}),
  });
  const schema = schemas('balance');
  const success = schema.output.oneOf[0] as {
    properties: Record<string, unknown>;
  };
  expect(success.properties.data).toMatchObject({
    required: [
      'accountValue',
      'accountValueUnits',
      'withdrawable',
      'marginUsed',
    ],
  });
});
test('unknown fields are rejected instead of silently changing trade intent', async () => {
  expect(
    (await dispatch(['echo', '--json', '{"value":"hello","typo":true}'])).body,
  ).toMatchObject({ ok: false, code: 'CONFIG_INVALID' });
});
test('JSON prototype fields cannot conceal master secrets during parsing', async () => {
  const payload = '{"__proto__":{"privateKey":"' + 'ab'.repeat(32) + '"}}';
  expect((await dispatch(['echo', '--json', payload])).body).toMatchObject({
    ok: false,
    code: 'POLICY_REJECTED',
  });
});
