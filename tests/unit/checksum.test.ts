import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256, verifyBytes } from '@/entities/documents/checksum';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
describe('exact file verification', () => {
  it('matches fixed SHA-256 vectors including the empty file', async () => {
    expect(await sha256(bytes(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(await sha256(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
  it('preserves binary bytes, Unicode and line endings', async () => {
    for (const data of [
      new Uint8Array([0, 255, 128, 13, 10, 0]),
      new TextEncoder().encode('Résumé — 日本語\r\n'),
    ]) {
      const expected = createHash('sha256').update(data).digest('hex');
      expect(await sha256(data.buffer)).toBe(expected);
    }
    expect(await sha256(bytes('line\r\n'))).not.toBe(
      await sha256(bytes('line\n'))
    );
  });
  it('preserves leading zeroes in the digest', async () => {
    const data = Array.from({ length: 2000 }, (_, index) => `${index}`).find(
      text => createHash('sha256').update(text).digest('hex').startsWith('00')
    )!;
    const digest = await sha256(bytes(data));
    expect(digest).toHaveLength(64);
    expect(digest).toBe(createHash('sha256').update(data).digest('hex'));
  });
  it('rejects changed bytes and incorrect sizes', async () => {
    const checksum = await sha256(bytes('original'));
    expect(
      (await verifyBytes(bytes('original'), { sizeBytes: 8, checksum })).matches
    ).toBe(true);
    expect(
      (await verifyBytes(bytes('Original'), { sizeBytes: 8, checksum })).matches
    ).toBe(false);
    expect(
      (await verifyBytes(bytes('original'), { sizeBytes: 9, checksum })).matches
    ).toBe(false);
    await expect(
      verifyBytes(bytes('original'), { sizeBytes: 8, checksum: 'invalid' })
    ).rejects.toThrow('Invalid expected');
  });
});
