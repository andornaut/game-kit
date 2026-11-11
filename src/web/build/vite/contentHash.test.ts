import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { VITE_HASHED_NAME } from "../../headers/securityHeaders.ts";
import { digestContentHash } from "../../pwa/cachePolicy.ts";
import { contentHash, HASH_LENGTH } from "./contentHash.ts";

describe("contentHash", () => {
  it.each([
    ["no bytes", new Uint8Array()],
    ["some bytes", new TextEncoder().encode("atlas page")],
    ["bytes whose hash uses URL-safe characters", new Uint8Array([0xfb, 0xff])],
  ])("is the start of the SHA-256 of %s in URL-safe base64", (_, bytes) => {
    const sha = createHash("sha256").update(bytes).digest("base64url");
    expect(contentHash(bytes)).toBe(sha.slice(0, HASH_LENGTH));
    expect(`atlas-${contentHash(bytes)}.webp`).toMatch(VITE_HASHED_NAME);
  });

  // The precache records contentHash at build time and the service worker compares it with
  // digestContentHash of the bytes it holds.
  it.each([
    ["no bytes", new Uint8Array()],
    ["some bytes", new TextEncoder().encode("atlas page")],
    ["bytes whose hash uses URL-safe characters", new Uint8Array([0xfb, 0xff])],
  ])("is digestContentHash of the SHA-256 digest of %s", (_, bytes) => {
    const digest = new Uint8Array(createHash("sha256").update(bytes).digest());
    expect(digestContentHash(digest)).toBe(contentHash(bytes));
  });

  it("names the empty input as Vite would", () => {
    // SHA-256 of nothing is 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU in URL-safe base64.
    expect(contentHash(new Uint8Array())).toBe("47DEQpj8");
  });
});
