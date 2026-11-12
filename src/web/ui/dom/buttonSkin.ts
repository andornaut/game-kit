import { type AsepriteSheet, type AsepriteTag, sheetTags } from "../../../art/aseprite.ts";
import type { Rect } from "../../../rect.ts";
import { cutFrame } from "./sheetFrames.ts";

// Button faces from art-kit sprite sheets, as CSS images. A button sheet holds each state's frames
// side by side and a CSS image takes a whole image, so each tag's first frame is cut into its own
// blob: image and set on a root as a custom property. One skin fetches the manifest, each sheet's
// JSON and PNG, and cuts each frame once for the page, however many roots it is applied to.

export interface ButtonSkinSource {
  // The art-kit sprite manifest's URL. Each sprite's json and png resolve against it.
  readonly manifestUrl: string;
  // The manifest keys of the button sheets.
  readonly sheets: readonly string[];
  // The tag names to cut from each sheet. A tag a sheet lacks sets no property.
  readonly tags: readonly string[];
}

export interface ButtonSkin {
  // Sets each cut frame's property on root and resolves to the blob: URLs set, for
  // imageReady's revealWhenDecoded. It never rejects.
  apply(root: ElementCSSInlineStyle): Promise<readonly string[]>;
  // Each cut frame's blob: URL, keyed by its property, once every sheet is cut or has failed. A
  // failed manifest or sheet contributes nothing. It never rejects.
  readonly frames: Promise<ReadonlyMap<string, string>>;
}

// The custom property a sheet's tag sets.
export function buttonSkinProperty(sheet: string, tag: string): string {
  return `--${sheet}-${tag}`;
}

// An Aseprite frame's place in its sheet, in sheet pixels.
interface FrameRect {
  readonly h: number;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

interface FramedSheet extends AsepriteSheet {
  readonly frames: Readonly<
    Record<string, { readonly duration: number; readonly frame: FrameRect }>
  >;
}

interface Sprite {
  readonly json: string;
  readonly key: string;
  readonly png: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSprite = (value: unknown): value is Sprite =>
  isRecord(value) &&
  typeof value.json === "string" &&
  typeof value.key === "string" &&
  typeof value.png === "string";

const isTag = (value: unknown): value is AsepriteTag =>
  isRecord(value) &&
  typeof value.direction === "string" &&
  typeof value.from === "number" &&
  typeof value.name === "string" &&
  typeof value.to === "number";

const isFrameRect = (value: unknown): value is FrameRect =>
  isRecord(value) &&
  typeof value.h === "number" &&
  typeof value.w === "number" &&
  typeof value.x === "number" &&
  typeof value.y === "number";

const isFrame = (value: unknown): boolean =>
  isRecord(value) && typeof value.duration === "number" && isFrameRect(value.frame);

const isTags = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every(isTag));

// The parsed JSON as an Aseprite hash export with frame rects. Throws on any other shape.
function asSheet(value: unknown): FramedSheet {
  const valid =
    isRecord(value) &&
    isRecord(value.frames) &&
    Object.values(value.frames).every(isFrame) &&
    isRecord(value.meta) &&
    isTags(value.meta.frameTags);
  if (!valid) {
    throw new Error("Not an Aseprite hash export");
  }
  return value as unknown as FramedSheet;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

async function loadImage(document: Document, url: string): Promise<HTMLImageElement> {
  const image = document.createElement("img");
  image.src = url;
  await image.decode();
  return image;
}

// Each wanted tag's rect: the first frame the tag plays, as aseprite's sheetTags orders it.
// Throws on a tag that names a frame the export lacks.
function tagRects(tags: readonly string[], sheet: FramedSheet): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [tag, played] of sheetTags(sheet)) {
    const name = played[0]?.frame;
    const frame = name === undefined ? undefined : sheet.frames[name]?.frame;
    if (frame !== undefined && tags.includes(tag)) {
      rects.set(tag, { height: frame.h, width: frame.w, x: frame.x, y: frame.y });
    }
  }
  return rects;
}

// One sheet's cut frames by property. Rejects on any failed fetch, decode, parse or cut.
async function cutSheet(
  document: Document,
  tags: readonly string[],
  manifestUrl: string,
  sprite: Sprite,
): Promise<[string, string][]> {
  const [json, image] = await Promise.all([
    fetchJson(new URL(sprite.json, manifestUrl).href),
    loadImage(document, new URL(sprite.png, manifestUrl).href),
  ]);
  const rects = tagRects(tags, asSheet(json));
  return Promise.all(
    [...rects].map(async ([tag, rect]): Promise<[string, string]> => [
      buttonSkinProperty(sprite.key, tag),
      await cutFrame(document, image, rect),
    ]),
  );
}

async function buildFrames(
  document: Document,
  source: ButtonSkinSource,
): Promise<ReadonlyMap<string, string>> {
  const manifestUrl = new URL(source.manifestUrl, document.baseURI).href;
  let sprites: Sprite[];
  try {
    const manifest = await fetchJson(manifestUrl);
    const listed = isRecord(manifest) && Array.isArray(manifest.sprites) ? manifest.sprites : [];
    sprites = listed.filter(isSprite);
  } catch {
    return new Map();
  }
  const sheets = await Promise.all(
    source.sheets.map((key) => {
      const sprite = sprites.find((entry) => entry.key === key);
      return sprite === undefined
        ? []
        : cutSheet(document, source.tags, manifestUrl, sprite).catch(() => []);
    }),
  );
  return new Map(sheets.flat());
}

// The skin for source's sheets. Requests start at once, so the game creates one skin during boot
// and applies it to every root. A failed manifest or sheet is not requested again for this skin;
// a new skin requests everything again. The blob: URLs last for the page and are never revoked.
export function createButtonSkin(document: Document, source: ButtonSkinSource): ButtonSkin {
  const frames = buildFrames(document, source).catch(() => new Map<string, string>());
  return {
    async apply(root) {
      const cut = await frames;
      for (const [property, url] of cut) {
        root.style.setProperty(property, `url("${url}")`);
      }
      return [...cut.values()];
    },
    frames,
  };
}
