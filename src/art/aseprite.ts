// An Aseprite "hash" JSON export, as the game has parsed it, and the animations its tags make.
// The game validates the JSON: this takes the parsed shape.

// The ways Aseprite plays a tag's frames.
export const ASEPRITE_DIRECTIONS = ["forward", "reverse", "pingpong", "pingpong_reverse"] as const;
export type AsepriteDirection = (typeof ASEPRITE_DIRECTIONS)[number];

// A tag: a named run of frames, from and to being frame indexes in export order, both included.
export interface AsepriteTag {
  readonly direction: AsepriteDirection;
  readonly from: number;
  readonly name: string;
  readonly to: number;
}

// The parts of an export the animations are built from: each frame's duration in ms, keyed by
// frame name in export order (as Phaser's Aseprite loader names the texture's frames), and the
// tags.
export interface AsepriteSheet {
  readonly frames: Readonly<Record<string, { readonly duration: number }>>;
  readonly meta: { readonly frameTags?: readonly AsepriteTag[] };
}

// One frame of an animation: its texture frame name and how long it shows, in ms.
export interface AnimationFrame {
  readonly duration: number;
  readonly frame: string;
}

export interface AnimationSpec {
  readonly frames: readonly AnimationFrame[];
  readonly key: string;
}

// Tag names repeat across sprites (every character has walk), and Phaser's animation keys are
// global, so each key carries its texture's key.
export function animationKey(textureKey: string, tagName: string): string {
  return `${textureKey}:${tagName}`;
}

function pingpong(indexes: readonly number[]): number[] {
  return [...indexes, ...indexes.slice(1, -1).reverse()];
}

// The tag's frame indexes in play order. pingpong_reverse starts on the last frame, as Aseprite
// plays it.
function playOrder(tag: AsepriteTag): number[] {
  const forward = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => tag.from + i);
  const direction = tag.direction;
  switch (direction) {
    case "forward":
      return forward;
    case "reverse":
      return forward.reverse();
    case "pingpong":
      return pingpong(forward);
    case "pingpong_reverse":
      return pingpong(forward.reverse());
    default:
      direction satisfies never;
      throw new Error(`Tag ${tag.name} plays ${String(direction)}, not an Aseprite direction`);
  }
}

// Each tag's frames in play order, by tag name. Throws on a tag that names a frame the export
// lacks.
export function sheetTags(sheet: AsepriteSheet): ReadonlyMap<string, readonly AnimationFrame[]> {
  const frames = Object.entries(sheet.frames);
  return new Map(
    (sheet.meta.frameTags ?? []).map((tag) => [
      tag.name,
      playOrder(tag).map((index) => {
        const entry = frames[index];
        if (entry === undefined) {
          throw new Error(`Tag ${tag.name} refers to missing frame ${index}`);
        }
        const [frame, { duration }] = entry;
        return { duration, frame };
      }),
    ]),
  );
}

// Each tag's animation, keyed by animationKey.
export function animationSpecs(textureKey: string, sheet: AsepriteSheet): AnimationSpec[] {
  return [...sheetTags(sheet)].map(([tag, frames]) => ({
    frames,
    key: animationKey(textureKey, tag),
  }));
}

// How long one play of a tag lasts, in ms. Throws on a tag the sheet lacks.
export function tagMs(tags: ReadonlyMap<string, readonly AnimationFrame[]>, tag: string): number {
  const frames = tags.get(tag);
  if (frames === undefined) {
    throw new Error(`No tag ${tag}`);
  }
  return frames.reduce((sum, { duration }) => sum + duration, 0);
}

// A tag's Phaser repeat count: 0 plays it once and holds its last frame, -1 loops it. once names
// the tags that play once.
export function tagRepeat(once: readonly string[], tag: string): 0 | -1 {
  return once.includes(tag) ? 0 : -1;
}
