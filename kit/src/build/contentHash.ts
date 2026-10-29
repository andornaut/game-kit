import { createHash } from "node:crypto";

// Vite's hash length, which the security headers' check for an unhashed name expects.
export const HASH_LENGTH = 8;

// The first HASH_LENGTH characters of the bytes' SHA-256, in URL-safe base64, as Vite hashes a
// build file's name, for a file a game's build plugin writes beside Vite's.
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url").slice(0, HASH_LENGTH);
}
