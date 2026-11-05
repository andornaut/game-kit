// FNV-1a 64 over the UTF-8 bytes of text, as 16 lowercase hex digits. The 64-bit state is kept
// as two 32-bit halves; the prime is 2^40 + 0x1b3.
export function fnv1a64(text: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  const mix = (byte: number) => {
    lo = (lo ^ byte) >>> 0;
    const low = lo * 0x1b3;
    const carry = Math.floor(low / 0x100000000);
    hi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) >>> 0;
    lo = low >>> 0;
  };
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) {
      mix(code);
    } else if (code < 0x800) {
      mix(0xc0 | (code >> 6));
      mix(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    } else {
      mix(0xf0 | (code >> 18));
      mix(0x80 | ((code >> 12) & 0x3f));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}
