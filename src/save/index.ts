// What other areas import from save/; consumers import the package exports.
export {
  type SaveKeys,
  saveStore,
  type StoreLoadResult,
  type StoreSaveResult,
} from "./saveStore.ts";
export { type SaveStorage } from "./storage.ts";
export { type Checked, type SaveFormat, type StoredObject } from "./versionedSave.ts";
