import { expect, test } from 'vitest';
test('strict ESM runtime', () => expect(import.meta.url).toMatch(/^file:/));
