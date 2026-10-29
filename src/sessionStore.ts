// sessionStorage can be missing or throw (private browsing, blocked site data): a read then
// finds nothing, a write reports false and a remove does nothing, so the caller plays on.

// null when sessionStorage is unavailable or the key is unset.
export function sessionRead(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

// Whether the value was stored.
export function sessionWrite(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing stored is the same as nothing to remove.
  }
}
