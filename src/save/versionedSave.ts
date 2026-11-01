// A save is stored as JSON: an object whose integer version field names the format it was
// written in. The game owns the format; this module reads its version, runs its migrations and
// hands the result to the game to validate.

// A value, or why there is none.
export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

// A stored save as JSON parses it, before the game validates it.
export interface StoredObject {
  readonly [field: string]: unknown;
}

// A game's save format at its current version.
export interface SaveFormat<Doc> {
  readonly version: number;
  // migrations[n] turns a save stored at version n into one at version n + 1; the store then
  // sets its version. A save older than the oldest migration loads as corrupt.
  readonly migrations: Readonly<Record<number, (save: StoredObject) => StoredObject>>;
  // A new player's save, also played in place of one that cannot be loaded.
  fresh(): Doc;
  // A stored save at the current version, validated and made ready for play, or why it cannot
  // be (the game's schema rejects it).
  decode(stored: StoredObject): Checked<Doc>;
  // What is stored for a save, or why it cannot be stored. Its version field is set to the
  // current version.
  encode(save: Doc): Checked<StoredObject>;
}

// "new" when nothing was stored. "corrupt" carries the stored text so the caller can keep it as
// a backup; its save is fresh. "newer" is a save from a later version than this game: its save
// is fresh, and the stored save must be left as it is.
export type LoadResult<Doc> =
  | { raw: string; reason: string; save: Doc; status: "corrupt" }
  | { reason: string; save: Doc; status: "newer" }
  | { save: Doc; status: "loaded" | "new" };

function isStoredObject(value: unknown): value is StoredObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The stored version, if it is an integer.
function storedVersion(save: StoredObject): number | undefined {
  const { version } = save;
  return typeof version === "number" && Number.isSafeInteger(version) ? version : undefined;
}

// The save migrated from version from to the format's version, or why it cannot be.
function migrated<Doc>(
  format: SaveFormat<Doc>,
  from: number,
  save: StoredObject,
): Checked<StoredObject> {
  let current = save;
  for (let version = from; version < format.version; version += 1) {
    const migration = format.migrations[version];
    if (migration === undefined) {
      return { ok: false, reason: `the save is from version ${from}, older than this game` };
    }
    current = { ...migration(current), version: version + 1 };
  }
  return { ok: true, value: current };
}

// Parses, migrates and decodes the stored text. Never throws: a save from a later version
// yields a fresh save with status "newer", and anything else unreadable, a save older than the
// format's migrations reach included, a fresh save with status "corrupt".
export function loadSave<Doc>(format: SaveFormat<Doc>, raw: string | null): LoadResult<Doc> {
  if (raw === null) {
    return { save: format.fresh(), status: "new" };
  }
  const corrupt = (reason: string): LoadResult<Doc> => ({
    raw,
    reason,
    save: format.fresh(),
    status: "corrupt",
  });
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return corrupt("the save is not valid JSON");
    }
    if (!isStoredObject(parsed)) {
      return corrupt("the save is not an object");
    }
    const version = storedVersion(parsed);
    if (version === undefined) {
      return corrupt("the save has no integer version");
    }
    if (version > format.version) {
      return {
        reason: `the save is from version ${version}, newer than this game`,
        save: format.fresh(),
        status: "newer",
      };
    }
    const current = migrated(format, version, parsed);
    if (!current.ok) {
      return corrupt(current.reason);
    }
    const decoded = format.decode(current.value);
    return decoded.ok ? { save: decoded.value, status: "loaded" } : corrupt(decoded.reason);
  } catch (error) {
    return corrupt(String(error));
  }
}

// The text stored for a save at the format's version, or why it cannot be stored.
export function encodeSave<Doc>(format: SaveFormat<Doc>, save: Doc): Checked<string> {
  const encoded = format.encode(save);
  return encoded.ok
    ? { ok: true, value: JSON.stringify({ ...encoded.value, version: format.version }) }
    : encoded;
}
