import { encodeBuildArchiveIndex } from "./buildArchive.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  type BuildArchiveReference,
  GROUP_ARCHIVE_IDENTITY,
  MAX_UPDATE_UNITS,
} from "./buildContract.ts";
import { parseBuildArchiveReference } from "./buildRecords.ts";

export type UpdateGroupRecipeFile = readonly [
  url: string,
  byteSize: number,
  contentType: string,
  sha256: string,
];

export interface UpdateGroupRecipe {
  readonly archive: BuildArchiveReference;
  readonly files: readonly UpdateGroupRecipeFile[];
}

export interface UpdateGroupRecipes {
  readonly groups: readonly UpdateGroupRecipe[];
  readonly schema: 1;
}

export function encodeUpdateGroupRecipePrefix(
  files: readonly UpdateGroupRecipeFile[],
): Uint8Array<ArrayBuffer> {
  return encodeBuildArchiveIndex({
    buildId: GROUP_ARCHIVE_IDENTITY,
    files: files.map(([url, byteSize, contentType]) => [url, byteSize, contentType]),
    version: GROUP_ARCHIVE_IDENTITY,
  });
}

export function parseUpdateGroupRecipes(input: unknown): UpdateGroupRecipes {
  const value = input as Partial<UpdateGroupRecipes> | null;
  if (
    value === null ||
    typeof value !== "object" ||
    value.schema !== 1 ||
    !Array.isArray(value.groups) ||
    value.groups.length < 1 ||
    value.groups.length > MAX_UPDATE_UNITS
  ) {
    throw new TypeError("Invalid update group recipes");
  }

  const archives = new Set<string>();
  const urls = new Set<string>();
  const groups = (value.groups as readonly unknown[]).map((entry) => {
    const recipe = entry as Partial<UpdateGroupRecipe> | null;
    if (
      recipe === null ||
      typeof recipe !== "object" ||
      !Array.isArray(recipe.files) ||
      recipe.files.length === 0
    ) {
      throw new TypeError("Invalid update group recipe");
    }
    const { byteSize, sha256 } = parseBuildArchiveReference(recipe.archive);
    if (byteSize > BUILD_ARCHIVE_PART_BYTES || archives.has(sha256)) {
      throw new RangeError("Oversized or duplicate update group archive recipe");
    }
    archives.add(sha256);

    let payloadSize = 0;
    const files = (recipe.files as readonly unknown[]).map((file): UpdateGroupRecipeFile => {
      if (!Array.isArray(file) || file.length !== 4) {
        throw new TypeError("Invalid update group recipe file tuple");
      }
      const [url, size, contentType, digest]: unknown[] = file;
      if (
        typeof url !== "string" ||
        url.startsWith("/.game-kit/") ||
        urls.has(url) ||
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > byteSize - payloadSize ||
        typeof contentType !== "string" ||
        typeof digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(digest)
      ) {
        throw new TypeError("Invalid or duplicate update group recipe file");
      }
      urls.add(url);
      payloadSize += size;
      return [url, size, contentType, digest];
    });
    // The canonical encoder also rejects ambiguous paths and invalid media types.
    if (encodeUpdateGroupRecipePrefix(files).byteLength + payloadSize !== byteSize) {
      throw new RangeError("Update group recipe does not match the archive size");
    }
    return { archive: { byteSize, schema: 1 as const, sha256 }, files };
  });
  return { groups, schema: 1 };
}
