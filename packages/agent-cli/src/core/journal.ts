import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWrite, privateDirectory, syncDirectory } from './files.js';
import { withFileLock } from './lock.js';
import { AgentCliError } from '../errors/index.js';

export const MAX_JOURNAL_RECORD_BYTES = 1_048_576;
// Read only the final record, even when the journal has years of history.
export async function journalTail(
  path: string,
): Promise<{ size: number; start: number; tail: string; terminated: boolean }> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { size: 0, start: 0, tail: '', terminated: true };
    throw error;
  }
  try {
    const { size } = await file.stat();
    if (!size) return { size, start: 0, tail: '', terminated: true };
    const length = Math.min(size, MAX_JOURNAL_RECORD_BYTES + 1);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const terminated = buffer[length - 1] === 10;
    const end = terminated ? length - 1 : length;
    const newline = buffer.lastIndexOf(10, end - 1);
    if (newline < 0 && size > length)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Journal record exceeds size limit',
        { path },
      );
    return {
      size,
      start: size - length + newline + 1,
      tail: buffer.subarray(newline + 1, end).toString('utf8'),
      terminated,
    };
  } finally {
    await file.close();
  }
}

// Call under the journal lock, before any reader uses its final record.
export async function repairTornTail(
  path: string,
  now = Date.now(),
): Promise<{ repaired: boolean; quarantine?: string }> {
  const { tail, start, terminated } = await journalTail(path);
  if (terminated) return { repaired: false };
  let valid = false;
  try {
    JSON.parse(tail);
    valid = tail.length > 0;
  } catch {
    /* quarantine below */
  }
  const quarantine = valid ? undefined : `${path}.corrupt-${now}`;
  if (quarantine) await atomicWrite(quarantine, tail);
  const file = await open(path, 'r+');
  try {
    if (!valid) await file.truncate(start);
    if (valid) {
      await file.write(
        Buffer.from(tail + '\n'),
        0,
        Buffer.byteLength(tail) + 1,
        start,
      );
    }
    await file.sync();
  } finally {
    await file.close();
  }
  return { repaired: true, ...(quarantine ? { quarantine } : {}) };
}

export async function appendJournal(path: string, record: unknown) {
  const line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > MAX_JOURNAL_RECORD_BYTES)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Journal record exceeds size limit',
    );
  await privateDirectory(dirname(path));
  const file = await open(path, 'a', 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(line);
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(dirname(path));
}

// An indexed append with a durable reservation. If a process dies after append
// but before publishing the index, replay searches only bytes after the saved
// offset. Producers keep the record in an outbox until this returns.
export async function appendOnce<T extends { eventId?: string }>(
  path: string,
  eventId: string,
  make: () => Promise<T>,
): Promise<T> {
  return withFileLock(path + '.lock', async () => {
    await repairTornTail(path);
    const key = createHash('sha256').update(eventId).digest('hex');
    const index = `${path}.index/${key}.json`;
    let reservation: { offset: number; result?: T } | undefined;
    try {
      reservation = JSON.parse(await readFile(index, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (reservation) {
      if (!Number.isSafeInteger(reservation.offset) || reservation.offset < 0)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Invalid journal reservation',
        );
      if (reservation.result) {
        if (
          reservation.result.eventId !== eventId ||
          (await stat(path)).size <= reservation.offset
        )
          throw new AgentCliError(
            'CONFIG_INVALID',
            'Journal index does not match its retained record',
          );
        return reservation.result;
      }
      const file = await open(path, 'a+');
      try {
        const size = (await file.stat()).size;
        if (reservation.offset > size)
          throw new AgentCliError(
            'CONFIG_INVALID',
            'Journal was truncated after an append reservation',
          );
        const chunk = Buffer.alloc(
          Math.min(MAX_JOURNAL_RECORD_BYTES + 1, size - reservation.offset),
        );
        let offset = reservation.offset;
        let carry = '';
        const decoder = new StringDecoder('utf8');
        while (offset < size) {
          const { bytesRead } = await file.read(
            chunk,
            0,
            Math.min(chunk.length, size - offset),
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
          const lines = (
            carry + decoder.write(chunk.subarray(0, bytesRead))
          ).split('\n');
          carry = lines.pop()!;
          for (const line of lines.filter(Boolean)) {
            const record = JSON.parse(line) as T;
            if (record.eventId === eventId) {
              await atomicWrite(
                index,
                JSON.stringify({ offset: reservation.offset, result: record }),
              );
              return record;
            }
          }
        }
      } finally {
        await file.close();
      }
    } else {
      const offset = await stat(path)
        .then((s) => s.size)
        .catch((error) => {
          if (error.code === 'ENOENT') return 0;
          throw error;
        });
      reservation = { offset };
      await atomicWrite(index, JSON.stringify(reservation));
    }
    const record = { ...(await make()), eventId };
    await appendJournal(path, record);
    await atomicWrite(
      index,
      JSON.stringify({ offset: reservation.offset, result: record }),
    );
    return record;
  });
}
