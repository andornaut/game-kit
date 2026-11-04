import type { GameObjects, Renderer, Textures } from "phaser";

import type { RgbaImage } from "../../art/rgbaImage.ts";
import type { Point, Rect } from "../../rect.ts";

export type Size = Readonly<{ width: number; height: number }>;
export type Quad = readonly [Point, Point, Point, Point];
export type Colour = readonly [number, number, number, number];
export type Vertex = Readonly<{ at: Point; colour: Colour }>;
export type Owner = object;
// Two transformed basis columns, with no translation. Includes fontScale exactly once.
export type UiBasis = readonly [number, number, number, number];
export type Rgb = readonly [number, number, number];

export interface UiFontFace {
  readonly family: string;
  readonly role: string;
  readonly weight: string;
  readonly style: string;
}
export interface UiTextStyle {
  readonly face: UiFontFace;
  // Source FNT fontData.size, NOT logical fontSize. Full basis already includes its scale.
  readonly size: number;
  // FNT-font-unit distance from pen line top to alphabetic baseline, caller supplied.
  readonly baseline: number;
}
export interface UiGlyphPen {
  readonly text: string;
  readonly pen: Point;
  readonly baseline: number;
  readonly transform: UiBasis;
}
export interface UiTextCommand {
  readonly kind: "text";
  readonly owner: Owner;
  readonly face: UiFontFace;
  // Source FNT fontData.size; transform already includes the logical font scale.
  readonly size: number;
  readonly glyphs: readonly UiGlyphPen[];
  readonly tint: Rgb;
  readonly tintMode: "multiply" | "fill";
  readonly alpha: number;
}

export interface UiProjectionInput {
  readonly captureSize: Size;
  readonly cssSize: Size;
  readonly devicePixelRatio: number;
}
export interface UiProjection {
  readonly captureSize: Size;
  readonly backingSize: Size;
  readonly scaleX: number;
  readonly scaleY: number;
}
export interface UiRaster {
  readonly image: CanvasImageSource;
  // Signed spans map the source origin to quad TL; negative axes reverse that mapping.
  readonly source: Readonly<Rect>;
}
export type UiPaintCommand =
  | UiTextCommand
  | Readonly<{
      kind: "quad";
      owner: Owner;
      raster: UiRaster;
      quad: Quad;
      tint: Rgb;
      tintMode: "multiply" | "fill";
      alpha: number;
      sampling: "linear" | "nearest";
    }>
  | Readonly<{ kind: "triangles"; owner: Owner; vertices: readonly Vertex[] }>
  | Readonly<{ kind: "viewport-clip"; camera: object; rect: Readonly<Rect> }>;

export interface UiFrame {
  readonly id: number;
  readonly projection: UiProjection;
  readonly commands: readonly UiPaintCommand[];
}
export type UiIssue = Readonly<{
  owner: Owner;
  reason: "renderer" | "object-kind" | "mask" | "blend" | "effect" | "raster" | "font" | "viewport";
}>;
export type UiRefreshResult =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "not-ready"; reason: "fonts-pending" | "font-failed" }>
  | Readonly<{ status: "unsupported"; issues: readonly UiIssue[] }>;
export interface UiRootHandle {
  // One stable identity for the complete sibling-root group and modal exclusions.
  readonly owner: Owner;
  readonly roots: readonly GameObjects.GameObject[];
  refresh(roots?: readonly GameObjects.GameObject[]): UiRefreshResult;
  destroy(): void;
}
export type UiRegistration =
  | Readonly<{ status: "ready"; handle: UiRootHandle }>
  | Readonly<{ status: "not-ready"; reason: "fonts-pending" | "font-failed" }>
  | Readonly<{ status: "unsupported"; issues: readonly UiIssue[] }>;

export interface UiCapturePorts {
  // Resolves only after every exact supplied face is loaded and registered.
  // Rejection leaves the complete UI group on its existing renderer.
  readonly fontsReady: Promise<void>;
  textStyle(text: GameObjects.BitmapText): UiTextStyle | undefined;
  image(frame: Textures.Frame): UiRaster | undefined;
  // Active camera/context viewport in renderer capture coordinates, not object bounds.
  // A kernel default may derive this from the public context camera when equivalent.
  viewport(context: Renderer.WebGL.DrawingContext): Readonly<Rect> | undefined;
}
export interface UiPaintPorts {
  readonly context: CanvasRenderingContext2D;
  resizeBacking(size: Size): void;
  // Owned scratch contexts for exact tint/snapshot operations; no library DOM mounting.
  createSurface(size: Size): CanvasRenderingContext2D;
  releaseSurface(context: CanvasRenderingContext2D): void;
}
export interface WorldCapture {
  readonly frameId: number;
  readonly pixels: RgbaImage;
  readonly captureArea: Readonly<Rect>;
}
export type UiWorldReadFailure = "frame" | "framebuffer" | "context" | "bounds" | "readback";
export type UiWorldReadResult =
  | Readonly<{ status: "captured"; capture: WorldCapture }>
  | Readonly<{ status: "unavailable"; reason: UiWorldReadFailure }>;
export interface UiWorldReadContext {
  readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  readonly frameId: number;
  readonly captureSize: Size;
  readonly phase: "post-render";
  // Actual renderer representation, not a default or a colour policy.
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
}
export interface UiWorldReadRequest {
  readonly frameId: number;
  readonly area: Readonly<Rect>;
}
export type UiSnapshotResult =
  | Readonly<{
      status: "captured";
      frameId: number;
      pixels: RgbaImage;
      captureArea: Readonly<Rect>;
    }>
  | Readonly<{ status: "unavailable"; reason: UiWorldReadFailure | "raster" }>
  | Readonly<{ status: "disposed" }>;
export interface UiCompositeRequest {
  readonly frame: UiFrame;
  readonly area: Readonly<Rect>;
  readonly exclude: ReadonlySet<Owner>;
}
export interface UiCompositePorts {
  // Called and completed inside Game.POST_RENDER before any await/yield.
  captureWorld(request: UiWorldReadRequest): UiWorldReadResult;
  createSurface(size: Size): CanvasRenderingContext2D;
  releaseSurface(context: CanvasRenderingContext2D): void;
  // Receives the composite, exactly once, after world + selected UI paint.
  remap(pixels: RgbaImage): void;
}

// Replay a complete frame. The host owns mounting, CSS and the existing render clock.
export function presentUi(ports: UiPaintPorts, frame: UiFrame): void {
  const { context: ctx } = ports;
  const { backingSize, scaleX: sx, scaleY: sy } = frame.projection;
  if (ctx.canvas.width !== backingSize.width || ctx.canvas.height !== backingSize.height) {
    ports.resizeBacking(backingSize);
  }
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backingSize.width, backingSize.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.save();
    try {
      for (const command of frame.commands) {
        if (command.kind === "viewport-clip") {
          ctx.restore();
          ctx.save();
          ctx.setTransform(sx, 0, 0, sy, 0, 0);
          ctx.beginPath();
          ctx.rect(command.rect.x, command.rect.y, command.rect.width, command.rect.height);
          ctx.clip();
          continue;
        }
        ctx.save();
        try {
          if (command.kind === "text") {
            const { face, tint } = command;
            ctx.font = `${face.style} ${face.weight} ${command.size}px ${JSON.stringify(face.family)}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = `rgb(${tint.join(",")})`;
            ctx.globalAlpha = command.alpha;
            for (const glyph of command.glyphs) {
              const [a, b, c, d] = glyph.transform;
              ctx.setTransform(
                a * sx,
                b * sy,
                c * sx,
                d * sy,
                (glyph.pen.x + c * glyph.baseline) * sx,
                (glyph.pen.y + d * glyph.baseline) * sy,
              );
              ctx.fillText(glyph.text, 0, 0);
            }
          } else if (command.kind === "quad") {
            paintQuad(ports, frame.projection, command);
          } else {
            const vertices = command.vertices;
            if (vertices.length === 0) {
              continue;
            }
            const colour = vertices[0]!.colour;
            if (
              vertices.length % 3 !== 0 ||
              vertices.some((v) => v.colour.some((component, i) => component !== colour[i]))
            ) {
              throw new RangeError("UI triangles require uniform colour and complete triangles");
            }
            ctx.setTransform(sx, 0, 0, sy, 0, 0);
            ctx.fillStyle = `rgb(${colour.slice(0, 3).join(",")})`;
            ctx.globalAlpha = colour[3];
            ctx.beginPath();
            // One compound fill avoids blending shared triangle edges twice.
            for (let i = 0; i < vertices.length; i += 3) {
              const a = vertices[i]!.at;
              let b = vertices[i + 1]!.at;
              let c = vertices[i + 2]!.at;
              if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) {
                [b, c] = [c, b];
              }
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.lineTo(c.x, c.y);
              ctx.closePath();
            }
            ctx.fill();
          }
        } finally {
          ctx.restore();
        }
      }
    } finally {
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}

// Tinted rasters are cached only for sources whose pixels cannot change after load.
// The cache is least recently used and bounded by entries and retained pixels.
const TINT_CACHE_ENTRIES = 256;
const TINT_CACHE_PIXELS = 4 * 1024 * 1024;
interface TintEntry {
  readonly pixels: number;
  readonly release: UiPaintPorts["releaseSurface"];
  readonly src: string | undefined;
  readonly surface: CanvasRenderingContext2D;
}
const tintCache = new Map<string, TintEntry>();
let tintPixels = 0;
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(value: object): number {
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return id;
}
function imageSource(image: CanvasImageSource): string | undefined {
  return typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement
    ? image.currentSrc
    : undefined;
}
function immutableImage(image: CanvasImageSource): boolean {
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
    // A closed bitmap has zero width and keeps the uncached path's failure.
    return image.width > 0;
  }
  return (
    typeof HTMLImageElement !== "undefined" &&
    image instanceof HTMLImageElement &&
    image.complete &&
    image.naturalWidth > 0
  );
}
// Surfaces are keyed by their release port, so each is released through the port that made it.
function tintKey(
  ports: UiPaintPorts,
  image: CanvasImageSource,
  source: Readonly<Rect>,
  command: Extract<UiPaintCommand, { kind: "quad" }>,
): string | undefined {
  if (!immutableImage(image)) {
    return undefined;
  }
  const { height, width, x, y } = source;
  const [r, g, b] = command.tint;
  return [
    identity(ports.releaseSurface),
    identity(image),
    x,
    y,
    width,
    height,
    command.tintMode,
    r,
    g,
    b,
  ].join(",");
}
function evict(key: string, entry: TintEntry): void {
  tintCache.delete(key);
  tintPixels -= entry.pixels;
  entry.release(entry.surface);
}
function retain(key: string, entry: TintEntry): void {
  const previous = tintCache.get(key);
  if (previous) {
    evict(key, previous);
  }
  tintCache.set(key, entry);
  tintPixels += entry.pixels;
  for (const [oldest, value] of tintCache) {
    if (tintCache.size <= TINT_CACHE_ENTRIES && tintPixels <= TINT_CACHE_PIXELS) {
      break;
    }
    evict(oldest, value);
  }
}

// Release every cached tint surface created through this release port, for host teardown.
export function releaseUiTintCache(ports: Pick<UiPaintPorts, "releaseSurface">): void {
  for (const [key, entry] of tintCache) {
    if (entry.release === ports.releaseSurface) {
      evict(key, entry);
    }
  }
}

function paintQuad(
  ports: UiPaintPorts,
  projection: UiProjection,
  command: Extract<UiPaintCommand, { kind: "quad" }>,
): void {
  const { context: ctx } = ports;
  const { image, source: input } = command.raster;
  if (
    ![
      input.x,
      input.y,
      input.width,
      input.height,
      ...command.quad.flatMap(({ x, y }) => [x, y]),
    ].every(Number.isFinite)
  ) {
    throw new RangeError("UI raster requires finite geometry");
  }
  const source = { ...input };
  let destination = command.quad;
  if (source.width < 0) {
    source.x += source.width;
    source.width = -source.width;
    destination = [destination[3], destination[2], destination[1], destination[0]];
  }
  if (source.height < 0) {
    source.y += source.height;
    source.height = -source.height;
    destination = [destination[1], destination[0], destination[3], destination[2]];
  }
  if (![source.x, source.y].every(Number.isFinite)) {
    throw new RangeError("UI raster requires finite geometry");
  }
  if (source.width === 0 || source.height === 0) {
    const [tl, bl, , tr] = destination;
    if ((tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x) === 0) {
      return;
    }
    throw new RangeError("UI raster zero spans require a degenerate destination");
  }
  const size = { height: Math.ceil(source.height), width: Math.ceil(source.width) };
  if (command.tintMode === "multiply" && command.tint.every((component) => component === 255)) {
    const [tl, bl, , tr] = destination;
    const { scaleX: sx, scaleY: sy } = projection;
    ctx.setTransform(
      ((tr.x - tl.x) / source.width) * sx,
      ((tr.y - tl.y) / source.width) * sy,
      ((bl.x - tl.x) / source.height) * sx,
      ((bl.y - tl.y) / source.height) * sy,
      tl.x * sx,
      tl.y * sy,
    );
    ctx.globalAlpha = command.alpha;
    ctx.imageSmoothingEnabled = command.sampling === "linear";
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      source.width,
      source.height,
    );
    return;
  }
  const key = tintKey(ports, image, source, command);
  const cached = key === undefined ? undefined : tintCache.get(key);
  if (cached && cached.src === imageSource(image)) {
    tintCache.delete(key!);
    tintCache.set(key!, cached);
    drawTinted(ctx, projection, command, destination, size, cached.surface);
    return;
  }
  const scratch = ports.createSurface(size);
  let retained = false;
  try {
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.clearRect(0, 0, size.width, size.height);
    scratch.globalAlpha = 1;
    scratch.globalCompositeOperation = "source-over";
    scratch.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      size.width,
      size.height,
    );
    const pixels = scratch.getImageData(0, 0, size.width, size.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        pixels.data[i + channel] =
          command.tintMode === "fill"
            ? command.tint[channel]!
            : Math.round((pixels.data[i + channel]! * command.tint[channel]!) / 255);
      }
    }
    scratch.putImageData(pixels, 0, 0);
    drawTinted(ctx, projection, command, destination, size, scratch);
    if (key !== undefined && size.width * size.height <= TINT_CACHE_PIXELS) {
      retain(key, {
        pixels: size.width * size.height,
        release: ports.releaseSurface,
        src: imageSource(image),
        surface: scratch,
      });
      retained = true;
    }
  } finally {
    if (!retained) {
      ports.releaseSurface(scratch);
    }
  }
}

function drawTinted(
  ctx: CanvasRenderingContext2D,
  projection: UiProjection,
  command: Extract<UiPaintCommand, { kind: "quad" }>,
  destination: Quad,
  size: Size,
  surface: CanvasRenderingContext2D,
): void {
  const [tl, bl, , tr] = destination;
  const { height, width } = size;
  const { scaleX: sx, scaleY: sy } = projection;
  ctx.setTransform(
    ((tr.x - tl.x) / width) * sx,
    ((tr.y - tl.y) / width) * sy,
    ((bl.x - tl.x) / height) * sx,
    ((bl.y - tl.y) / height) * sy,
    tl.x * sx,
    tl.y * sy,
  );
  ctx.globalAlpha = command.alpha;
  ctx.imageSmoothingEnabled = command.sampling === "linear";
  ctx.drawImage(surface.canvas, 0, 0);
}
