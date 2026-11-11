import { Textures } from "phaser";

// Sets each key's texture filter on every source the key draws from. Throws, before changing any
// filter, on a key with no texture or on keys that share a source (an atlas page) with different
// modes, since the filter belongs to the source.
export function setTextureFilters(
  textures: Textures.TextureManager,
  filters: ReadonlyMap<string, "linear" | "nearest">,
): void {
  const modes = new Map<Textures.TextureSource, { key: string; mode: "linear" | "nearest" }>();
  for (const [key, mode] of filters) {
    if (!textures.exists(key)) {
      throw new Error(`No texture ${key} to filter`);
    }
    for (const source of textures.get(key).source) {
      const set = modes.get(source);
      if (set && set.mode !== mode) {
        throw new Error(`Textures ${set.key} and ${key} share a source with different filters`);
      }
      modes.set(source, { key, mode });
    }
  }
  for (const [source, { mode }] of modes) {
    source.setFilter(mode === "linear" ? Textures.FilterMode.LINEAR : Textures.FilterMode.NEAREST);
  }
}
