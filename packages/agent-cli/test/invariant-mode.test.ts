import { afterEach, expect, test, vi } from 'vitest';
const detached = vi.hoisted(() =>
  vi.fn(async (_args: string[], _path?: string) => ({
    pid: process.pid,
    ready: true,
  })),
);
vi.mock('../src/runner/lifecycle.js', async (original) => {
  const actual = await original<typeof import('../src/runner/lifecycle.js')>();
  return {
    ...actual,
    get activeRunner() {
      return actual.activeRunner;
    },
    detachRunner: detached,
  };
});
vi.mock('../src/paper/engine.js', () => ({
  startPaperEngine: vi.fn(async () => ({})),
}));
import '../src/commands/run.js';
import '../src/commands/read.js';
import { dispatch } from '../src/core/router.js';
import { saveConfig, migrate, loadConfig } from '../src/core/config.js';
import { activeRunner, setActiveRunner } from '../src/runner/lifecycle.js';
import { rpcCall, socketPath } from '../src/runner/rpc.js';
import { paperDir } from '../src/core/mode.js';
import { PaperStore } from '../src/paper/store.js';
afterEach(async () => {
  await activeRunner?.shutdown();
  setActiveRunner(undefined);
  vi.clearAllMocks();
});
test('run JSON paper intent pins both the runner and raw RPC to paper', async () => {
  await saveConfig(migrate({}));
  const result = await dispatch(['run', '--json', '{"paper":true}']);
  expect(result.body).toMatchObject({
    ok: true,
    mode: 'paper',
    data: { mode: 'paper', paper: true },
  });
  expect(activeRunner?.config.mode).toBe('paper');
  await new PaperStore().reset(1000);
  vi.stubGlobal('fetch', async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    if (body.type === 'metaAndAssetCtxs')
      return Response.json([{ universe: [] }, []]);
    throw new Error('Unexpected request');
  });
  expect(await rpcCall('balance', {}, socketPath(paperDir()))).toMatchObject({
    accountValue: '1000',
  });
});
test('explicit live detach passes live intent to a child even with saved paper mode', async () => {
  const config = await loadConfig();
  config.mode = 'paper';
  await saveConfig(config);
  expect((await dispatch(['run', '--live', '--detach'])).body).toMatchObject({
    ok: true,
    mode: 'live',
  });
  expect(detached.mock.calls.at(-1)![0]).toContain('--live');
  expect(detached.mock.calls.at(-1)![0]).not.toContain('--paper');
});
