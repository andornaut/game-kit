import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { contentHash, HASH_LENGTH } from "./contentHash";

describe("contentHash", () => {
  it.each([
    ["no bytes", new Uint8Array()],
    ["some bytes", new TextEncoder().encode("atlas page")],
  ])("is the start of the SHA-256 of %s in URL-safe base64", (_, bytes) => {
    const sha = createHash("sha256").update(bytes).digest("base64url");
    expect(contentHash(bytes)).toBe(sha.slice(0, HASH_LENGTH));
  });

  it("names the empty input as Vite would", () => {
    // SHA-256 of nothing is 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU in URL-safe base64.
    expect(contentHash(new Uint8Array())).toBe("47DEQpj8");
  });
});
