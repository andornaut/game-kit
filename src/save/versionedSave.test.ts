import { describe, expect, it } from "vitest";

import { type Checked, encodeSave, loadSave, type SaveFormat } from "./versionedSave";

// A type, not an interface, so it is a StoredObject.
type Coins = {
  coins: number;
  name: string;
};

// Version 3. Version 1 named coins gold; version 2 added the name. Version 0 has no migration.
const FORMAT: SaveFormat<Coins> = {
  decode: ({ coins, name }) =>
    typeof coins === "number" && coins >= 0 && typeof name === "string"
      ? { ok: true, value: { coins, name } }
      : { ok: false, reason: "coins must be a count and name a string" },
  encode: (save): Checked<Coins> =>
    save.coins >= 0 ? { ok: true, value: save } : { ok: false, reason: "coins below 0" },
  fresh: () => ({ coins: 0, name: "" }),
  migrations: {
    1: ({ gold, ...save }) => ({ ...save, coins: gold }),
    2: (save) => ({ ...save, name: "Duck" }),
  },
  version: 3,
};

const FRESH = { coins: 0, name: "" };
const json = (value: unknown) => JSON.stringify(value);

describe("loadSave", () => {
  it.each<[string, string | null, unknown]>([
    ["nothing stored as new", null, { save: FRESH, status: "new" }],
    [
      "a current save",
      json({ coins: 5, name: "Ana", version: 3 }),
      { save: { coins: 5, name: "Ana" }, status: "loaded" },
    ],
    [
      "a save one migration old",
      json({ coins: 5, version: 2 }),
      { save: { coins: 5, name: "Duck" }, status: "loaded" },
    ],
    [
      "a save two migrations old",
      json({ gold: 7, version: 1 }),
      { save: { coins: 7, name: "Duck" }, status: "loaded" },
    ],
    [
      "a later version's save as newer",
      json({ coins: 5, version: 4 }),
      { reason: "the save is from version 4, newer than this game", save: FRESH, status: "newer" },
    ],
  ])("loads %s", (_case, raw, result) => {
    expect(loadSave(FORMAT, raw)).toEqual(result);
  });

  it.each<[string, string, string]>([
    ["text that is not JSON", "{coins", "the save is not valid JSON"],
    ["JSON that is not an object", "[1]", "the save is not an object"],
    ["a save with no version", json({ coins: 5 }), "the save has no integer version"],
    ["a fractional version", json({ coins: 5, version: 2.5 }), "the save has no integer version"],
    [
      "a save older than the migrations",
      json({ version: 0 }),
      "the save is from version 0, older than this game",
    ],
    [
      "a save the game's schema rejects",
      json({ coins: -1, name: "", version: 3 }),
      "coins must be a count and name a string",
    ],
  ])("loads %s as corrupt, keeping its text", (_case, raw, reason) => {
    expect(loadSave(FORMAT, raw)).toEqual({ raw, reason, save: FRESH, status: "corrupt" });
  });

  it("loads a save whose migration throws as corrupt", () => {
    const throwing = {
      ...FORMAT,
      migrations: {
        ...FORMAT.migrations,
        2: () => {
          throw new Error("no name");
        },
      },
    };
    const raw = json({ coins: 1, version: 2 });
    expect(loadSave(throwing, raw)).toEqual({
      raw,
      reason: "Error: no name",
      save: FRESH,
      status: "corrupt",
    });
  });
});

describe("encodeSave", () => {
  it.each<[string, Coins, Checked<string>]>([
    [
      "stores a save at the current version",
      { coins: 2, name: "Ana" },
      { ok: true, value: json({ coins: 2, name: "Ana", version: 3 }) },
    ],
    [
      "refuses one the format cannot encode",
      { coins: -1, name: "" },
      { ok: false, reason: "coins below 0" },
    ],
  ])("%s", (_case, save, encoded) => {
    expect(encodeSave(FORMAT, save)).toEqual(encoded);
  });

  it("round-trips through loadSave", () => {
    const encoded = encodeSave(FORMAT, { coins: 9, name: "Bo" });
    expect(encoded.ok && loadSave(FORMAT, encoded.value)).toEqual({
      save: { coins: 9, name: "Bo" },
      status: "loaded",
    });
  });
});
