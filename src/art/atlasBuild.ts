import type { Point, Rect } from "../rect.ts";
import { blankImage, blitExtruded, type RgbaImage } from "./rgbaImage.ts";

export interface AtlasBlit {
  source: string;
  from: Rect;
  at: Point;
  bounds?: Rect;
}

export interface AtlasBuildPage<M> {
  width: number;
  height: number;
  blits: readonly AtlasBlit[];
  metadata: M;
}

export interface AtlasBuildDependencies {
  read: (source: string) => Promise<Uint8Array>;
  decode: (bytes: Uint8Array) => RgbaImage | Promise<RgbaImage>;
  encode: (image: RgbaImage) => Uint8Array | Promise<Uint8Array>;
  decoded?: ReadonlyMap<string, RgbaImage>;
  extrude: number;
}

export function drawAtlasPage(
  extrude: number,
  images: ReadonlyMap<string, RgbaImage>,
  { blits, height, width }: AtlasBuildPage<unknown>,
): RgbaImage {
  const page = blankImage(width, height);
  for (const { at, bounds, from, source } of blits) {
    const image = images.get(source);
    if (image === undefined) {
      throw new Error(`No atlas source for ${source}`);
    }
    blitExtruded(image, from, extrude, page, at, bounds);
  }
  return page;
}

// Source promises are shared across pages; page and blit order remain caller supplied.
export async function buildAtlasPages<M>(
  dependencies: AtlasBuildDependencies,
  pages: readonly AtlasBuildPage<M>[],
): Promise<{ image: RgbaImage; bytes: Uint8Array; metadata: M }[]> {
  const { decode, decoded, encode, extrude, read } = dependencies;
  const sources = new Map<string, Promise<RgbaImage>>();
  for (const { blits } of pages) {
    for (const { source } of blits) {
      if (!sources.has(source)) {
        const image = decoded?.get(source);
        sources.set(
          source,
          image === undefined ? read(source).then(decode) : Promise.resolve(image),
        );
      }
    }
  }
  const images = new Map(
    await Promise.all([...sources].map(async ([key, image]) => [key, await image] as const)),
  );
  return Promise.all(
    pages.map(async (page) => {
      const image = drawAtlasPage(extrude, images, page);
      return { bytes: await encode(image), image, metadata: page.metadata };
    }),
  );
}
