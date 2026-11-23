import { expect, it } from "vitest";

import { encodeBuildArchiveIndex } from "./buildArchive.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  MAX_UPDATE_UNITS,
  updateGroupRecipesPath,
} from "./buildContract.ts";
import {
  encodeUpdateGroupRecipePrefix,
  parseUpdateGroupRecipes,
  type UpdateGroupRecipeFile,
} from "./buildGroupRecipes.ts";

const files: readonly UpdateGroupRecipeFile[] = [
  ["/first", 5, "text/plain", "b".repeat(64)],
  ["/next", 0, "text/plain", "c".repeat(64)],
];
const prefix = encodeBuildArchiveIndex({
  buildId: "group",
  files: [
    ["/first", 5, "text/plain"],
    ["/next", 0, "text/plain"],
  ],
  version: "group",
});
const archive = { byteSize: prefix.byteLength + 5, schema: 1, sha256: "a".repeat(64) };
const recipe = { archive, files };

it("preserves exact canonical group header and ordered members", () => {
  const definition = { groups: [recipe], schema: 1 };
  expect(parseUpdateGroupRecipes(definition)).toEqual(definition);
  expect(encodeUpdateGroupRecipePrefix(files)).toEqual(prefix);
  expect(updateGroupRecipesPath("b2a37")).toBe("/.game-kit/group-recipes-b2a37.json");
});

it("rejects ambiguous, oversized or incomplete recipes before reading bytes", () => {
  const invalid = [
    [recipe, recipe],
    [{ ...recipe, archive: { ...archive, byteSize: archive.byteSize + 1 } }],
    [{ ...recipe, archive: { ...archive, byteSize: BUILD_ARCHIVE_PART_BYTES + 1 } }],
    [{ ...recipe, files: [files[0], files[0]] }],
    [{ ...recipe, files: [["/a/../first", 5, "text/plain", "b".repeat(64)]] }],
    [{ ...recipe, files: [["/.game-kit/archive", 5, "text/plain", "b".repeat(64)]] }],
    [{ ...recipe, files: [["/first", 5, "text/plain", "b".repeat(63)]] }],
    Array.from({ length: MAX_UPDATE_UNITS + 1 }, () => recipe),
  ];
  for (const groups of invalid) {
    expect(() => parseUpdateGroupRecipes({ groups, schema: 1 })).toThrow();
  }
  expect(() => parseUpdateGroupRecipes({ groups: [recipe], schema: 2 })).toThrow();
  expect(() => updateGroupRecipesPath("../version")).toThrow();
});
