import type { SaveStorage } from "./storage.ts";
import { encodeSave, loadSave, type SaveFormat } from "./versionedSave.ts";

// Where a game keeps its save, and where a save it could not read is copied before the next
// write replaces it.
export interface SaveKeys {
  readonly backup: string;
  readonly save: string;
}

// "unavailable" means storage failed or a write fence prevented backing up corrupt text; its
// save is a fresh placeholder. "newer" means the stored header exceeds this format: its save is
// a placeholder; callers must block play and load a compatible version before using that save.
// "corrupt" means the stored save could not be read and was copied to the backup key; its save
// is fresh. Neither unavailable nor newer authorizes overwriting the original.
export type StoreLoadResult<Doc> =
  | { reason: string; save: Doc; status: "corrupt" | "newer" | "unavailable" }
  | { save: Doc; status: "loaded" | "new" };

export type StoreSaveResult =
  { reason: string; status: "invalid" | "unavailable" } | { status: "saved" };

export interface SaveStore<Doc> {
  // Irreversibly prevents future storage writes for this store; the first reason wins. Reads
  // remain available and never rearm writes. A backend write already entered may still finish
  // and report its actual result; this is not cancellation or a rollback.
  blockWrites(reason: string): void;
  load(): Promise<StoreLoadResult<Doc>>;
  save(save: Doc): Promise<StoreSaveResult>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A save in format, kept in storage at keys. Failed reads/backups and newer saves latch the
// session's write fence, preventing later storage-write entry. An already-entered write keeps
// its actual result. Invalid encoding leaves storage unchanged. blockWrites also fences backup
// writes after a pending read; save rechecks after encoding callbacks run.
export function saveStore<Doc>(
  storage: SaveStorage,
  keys: SaveKeys,
  format: SaveFormat<Doc>,
): SaveStore<Doc> {
  // Why writes are refused for the session, or null while they are allowed.
  let writesBlocked: string | null = null;
  const blockWrites = (reason: string) => {
    writesBlocked ??= reason;
  };

  const unavailable = (error: unknown): StoreLoadResult<Doc> => {
    blockWrites("storage was unavailable at load");
    return { reason: describe(error), save: format.fresh(), status: "unavailable" };
  };

  return {
    blockWrites,
    async load() {
      let raw: string | null;
      try {
        raw = await storage.read(keys.save);
      } catch (error) {
        return unavailable(error);
      }
      const result = loadSave(format, raw);
      if (result.status === "newer") {
        blockWrites("a newer version of the game wrote the stored save");
        return result;
      }
      if (result.status !== "corrupt") {
        return result;
      }
      if (writesBlocked !== null) {
        return { reason: writesBlocked, save: result.save, status: "unavailable" };
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
      if (writesBlocked !== null) {
        return { reason: writesBlocked, status: "unavailable" };
      }
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
