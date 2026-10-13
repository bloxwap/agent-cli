import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore, readEvents } from '../src/runner/events.js';
test('event replay preserves monotonic seq across restart and filters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-events-'));
  const path = join(dir, 'events.jsonl');
  try {
    const store = new EventStore(path);
    await Promise.all([
      store.append('fill', { tid: 1 }),
      store.append('error', { ok: false, code: 'NETWORK_ERROR' }),
    ]);
    await new EventStore(path).append('deposit', { id: 'deposit' });
    expect((await readEvents(path)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await readEvents(path, 1, ['deposit'])).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('independent event writers serialize sequences and expose exact fee units', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-events-parallel-'));
  const path = join(dir, 'events.jsonl');
  try {
    await Promise.all([
      new EventStore(path).append('fill', { tid: 1, fee: '0.00000001' }),
      new EventStore(path).append('deposit', { id: 'one' }),
    ]);
    const entries = await readEvents(path);
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(entries.find((e) => e.type === 'fill')?.data).toMatchObject({
      feeUnits: '1',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
