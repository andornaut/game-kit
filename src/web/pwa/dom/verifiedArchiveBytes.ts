export async function readExactArchiveBytes(
  source: ReadableStream<Uint8Array>,
  bytes: Uint8Array<ArrayBuffer>,
  label: string,
): Promise<void> {
  const reader = source.getReader();
  let offset = 0;
  try {
    for (;;) {
      // The stream is consumed in order and stopped as soon as it exceeds its declared size.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.byteLength > bytes.byteLength - offset) {
        throw new RangeError(`${label} exceeds its declared size`);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== bytes.byteLength) {
    throw new RangeError(`${label} does not match its declared size`);
  }
}

export async function checkArchiveDigest(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
  label: string,
) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== expected) {
    throw new TypeError(`${label} checksum mismatch`);
  }
}
