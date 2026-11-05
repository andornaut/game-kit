// The failures browser storage produces, shared by the storage fixtures: each check throws what
// the browser throws, or returns when the operation may go ahead.

// The failures a storage fixture produces, checked on each call, so a test may change them
// between calls. unavailable fails every read and write with a SecurityError, as storage blocked
// by the browser does. quota is the most characters the keys and values may hold together, as
// Web Storage counts them, or a predicate that is true when a write exceeds it: such a write
// fails with a QuotaExceededError and changes nothing. readThrows and writeThrows, when present,
// are what every read or write throws, ahead of the other failures.
export interface StorageFailures {
  quota?: number | ((key: string, value: string) => boolean);
  readThrows?: unknown;
  unavailable?: boolean;
  writeThrows?: unknown;
}

// An Error named as the DOMException a browser throws, so error.name and error.message read as
// they do from localStorage.
function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function size(entries: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const [key, value] of entries) {
    total += key.length + value.length;
  }
  return total;
}

function exceeds(
  quota: NonNullable<StorageFailures["quota"]>,
  entries: ReadonlyMap<string, string>,
  key: string,
  value: string,
): boolean {
  if (typeof quota === "function") {
    return quota(key, value);
  }
  const previous = entries.get(key);
  const replaced = previous === undefined ? 0 : key.length + previous.length;
  return size(entries) - replaced + key.length + value.length > quota;
}

function checkAvailable(failures: StorageFailures): void {
  if (failures.unavailable === true) {
    throw domError(
      "SecurityError",
      "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
    );
  }
}

// Throws what a read throws under failures.
export function checkRead(failures: StorageFailures): void {
  if ("readThrows" in failures) {
    throw failures.readThrows;
  }
  checkAvailable(failures);
}

// Throws what a write, or a removal when value is undefined, throws under failures over
// entries. Only a write is held to the quota.
export function checkWrite(
  failures: StorageFailures,
  entries: ReadonlyMap<string, string>,
  key: string,
  value?: string,
): void {
  if ("writeThrows" in failures) {
    throw failures.writeThrows;
  }
  checkAvailable(failures);
  if (value !== undefined && failures.quota !== undefined) {
    if (exceeds(failures.quota, entries, key, value)) {
      throw domError(
        "QuotaExceededError",
        `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
      );
    }
  }
}
