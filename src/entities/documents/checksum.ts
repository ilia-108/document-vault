export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('File verification requires a secure browser context');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
export async function verifyBytes(
  bytes: ArrayBuffer,
  expected: { sizeBytes: number; checksum: string }
): Promise<{ matches: boolean; actual: string }> {
  if (!/^[a-f0-9]{64}$/i.test(expected.checksum))
    throw new Error('Invalid expected SHA-256');
  const actual = await sha256(bytes);
  return {
    matches:
      bytes.byteLength === expected.sizeBytes &&
      actual === expected.checksum.toLowerCase(),
    actual,
  };
}
