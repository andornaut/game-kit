// Asks the browser to keep the site's storage, a game's save included, when it would otherwise
// evict it: under storage pressure, or Safari's 7 days without a visit. Only the installed app asks: in
// a browser tab Firefox would ask the player, while Chromium grants it on its own heuristics
// (an installed app is one) without asking.

// persisted: the browser keeps the storage. bestEffort: it may evict it. browserTab: not
// installed, so not asked. unsupported: the browser has no StorageManager.persist.
export type StoragePersistence = "bestEffort" | "browserTab" | "persisted" | "unsupported";

// The parts of navigator.storage this uses, so tests can pass a fake.
export interface StorageManagerLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
}

// Whether the browser keeps the storage already, false when it cannot say.
async function isPersisted(manager: StorageManagerLike): Promise<boolean> {
  try {
    return (await manager.persisted?.()) === true;
  } catch {
    return false;
  }
}

// Asks once, when installed and the storage is not kept already; a browser tab only reads
// whether it is. Never rejects and never throws, so a caller that does not wait for it is never
// held up: a refusal or an error reads as bestEffort.
export async function requestPersistentStorage(
  installed: boolean,
  manager: StorageManagerLike | undefined,
): Promise<StoragePersistence> {
  if (typeof manager?.persist !== "function") {
    return "unsupported";
  }
  if (await isPersisted(manager)) {
    return "persisted";
  }
  if (!installed) {
    return "browserTab";
  }
  try {
    return (await manager.persist()) ? "persisted" : "bestEffort";
  } catch {
    return "bestEffort";
  }
}
