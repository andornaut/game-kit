// What other areas import from web/pwa/archive/; consumers import the package exports.
export {
  BUILD_ARCHIVE_HEADER_BYTES,
  type BuildArchiveEntry,
  type BuildArchiveFile,
  type BuildArchiveIdentity,
  type BuildArchiveIndex,
  encodeBuildArchiveIndex,
  parseBuildArchiveIndex,
  readBuildArchivePrefixSize,
} from "./buildArchive.ts";
export {
  encodeUpdateGroupRecipePrefix,
  parseUpdateGroupRecipes,
  type UpdateGroupRecipe,
  type UpdateGroupRecipes,
} from "./buildGroupRecipes.ts";
