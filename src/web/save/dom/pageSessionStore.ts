// The page's sessionStorage as a session store that never throws (createSessionStore).
import { createSessionStore } from "../sessionStore.ts";

const store = createSessionStore(() => globalThis.sessionStorage);

// null when sessionStorage is unavailable or the key is unset.
export function sessionRead(key: string): string | null {
  return store.read(key);
}

// Whether the value was stored.
export function sessionWrite(key: string, value: string): boolean {
  return store.write(key, value);
}

export function sessionRemove(key: string): void {
  store.remove(key);
}
