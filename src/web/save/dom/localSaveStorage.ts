import type { SaveStorage } from "../../../save/storage.ts";
import { browserStorage, lazyStorage } from "../storage.ts";

// The page's localStorage as SaveStorage, looked up on each call (lazyStorage), so a missing or
// blocked localStorage rejects each operation instead of throwing here.
export function localSaveStorage(): SaveStorage {
  return browserStorage(lazyStorage(() => globalThis.localStorage));
}
