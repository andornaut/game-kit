import type { SaveStorage } from "./storage";
import { encodeSave, loadSave, type SaveFormat } from "./versionedSave";

// Where a game keeps its save, and where a save it could not read is copied before the next
// write replaces it.
export interface SaveKeys {
  readonly backup: string;
  readonly save: string;
}

// "unavailable" means storage threw: the game plays on with this save in memory and tells the
// player progress won't be saved. "newer" means a later version of the game wrote the stored
// save: the game plays on with this save in memory and offers the newer version. "corrupt"
// means the stored save could not be read: it was copied to the backup key and this save is
// fresh.
export type StoreLoadResult<Doc> =
  | { reason: string; save: Doc; status: "corrupt" | "newer" | "unavailable" }
  | { save: Doc; status: "loaded" | "new" };

export type StoreSaveResult =
  { reason: string; status: "invalid" | "unavailable" } | { status: "saved" };

export interface SaveStore<Doc> {
  load(): Promise<StoreLoadResult<Doc>>;
  save(save: Doc): Promise<StoreSaveResult>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A save in format, kept in storage at keys. Once a read fails, a corrupt save cannot be backed
// up, or the stored save is from a later version, the store stops writing for the session, so
// it never overwrites a save it could not read, keep or understand. A save the format cannot
// encode is not written ("invalid") and the stored one is kept.
export function saveStore<Doc>(
  storage: SaveStorage,
  keys: SaveKeys,
  format: SaveFormat<Doc>,
): SaveStore<Doc> {
  // Why writes are refused for the session, or null while they are allowed.
  let writesBlocked: string | null = null;

  const unavailable = (error: unknown): StoreLoadResult<Doc> => {
    writesBlocked = "storage was unavailable at load";
    return { reason: describe(error), save: format.fresh(), status: "unavailable" };
  };

  return {
    async load() {
      let raw: string | null;
      try {
        raw = await storage.read(keys.save);
      } catch (error) {
        return unavailable(error);
      }
      const result = loadSave(format, raw);
      if (result.status === "newer") {
        writesBlocked = "a newer version of the game wrote the stored save";
        return result;
      }
      if (result.status !== "corrupt") {
        return result;
      }
      try {
        await storage.write(keys.backup, result.raw);
      } catch (error) {
        return unavailable(error);
      }
      return { reason: result.reason, save: result.save, status: "corrupt" };
    },

    async save(save) {
      if (writesBlocked !== null) {
        return { reason: writesBlocked, status: "unavailable" };
      }
      const encoded = encodeSave(format, save);
      if (!encoded.ok) {
        return { reason: encoded.reason, status: "invalid" };
      }
      try {
        await storage.write(keys.save, encoded.value);
      } catch (error) {
        return { reason: describe(error), status: "unavailable" };
      }
      return { status: "saved" };
    },
  };
}
