import { open, readFile, writeFile } from 'node:fs/promises';

// A trailing partial line is quarantined. A final line that is already valid
// JSON is kept and terminated, so a crash after the record but before the
// newline does not drop a committed entry.
export async function repairTornTail(
  path: string,
  now = Date.now(),
): Promise<{ repaired: boolean; quarantine?: string }> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { repaired: false };
    throw error;
  }
  if (contents.length === 0 || contents.endsWith('\n'))
    return { repaired: false };
  const lastNl = contents.lastIndexOf('\n');
  const prefix = lastNl >= 0 ? contents.slice(0, lastNl + 1) : '';
  const tail = contents.slice(lastNl + 1);
  let salvage = false;
  try {
    JSON.parse(tail);
    salvage = tail.length > 0;
  } catch {
    salvage = false;
  }
  if (salvage) {
    const file = await open(path, 'a', 0o600);
    try {
      await file.writeFile('\n');
      await file.sync();
    } finally {
      await file.close();
    }
    return { repaired: true };
  }
  const quarantine = `${path}.corrupt-${now}`;
  await writeFile(quarantine, tail, { mode: 0o600 });
  const file = await open(path, 'r+', 0o600);
  try {
    await file.truncate(Buffer.byteLength(prefix));
    await file.sync();
  } finally {
    await file.close();
  }
  return { repaired: true, quarantine };
}
