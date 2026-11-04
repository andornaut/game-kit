import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uiGlyphPen } from "../../text/phaser/uiGlyphPen.ts";
import {
  presentUi,
  releaseUiTintCache,
  type Quad,
  type UiFrame,
  type UiPaintCommand,
  type UiWorldReadContext,
} from "./uiCommands.ts";
import { createUiCompositor, readUiWorldFrame } from "./uiComposite.ts";
import { uiProjection } from "./uiProjection.ts";

function surface(width: number, height: number) {
  const canvas = { height, pixels: new Uint8ClampedArray(width * height * 4), width };
  const operations: string[] = [];
  const context = {
    beginPath: vi.fn(),
    canvas,
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    drawImage: vi.fn((image: { pixels?: Uint8ClampedArray }) => {
      operations.push("image");
      if (image.pixels) {
        canvas.pixels.set(image.pixels.subarray(0, canvas.pixels.length));
      }
    }),
    fill: vi.fn(() => operations.push("fill")),
    fillText: vi.fn(() => operations.push("text")),
    getImageData: vi.fn(() => ({ data: canvas.pixels.slice() })),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    putImageData: vi.fn((image: { data: Uint8ClampedArray }) => {
      canvas.pixels.set(image.data);
    }),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
  };
  return { canvas, context, ctx: context as unknown as CanvasRenderingContext2D, operations };
}
const projection = uiProjection({
  captureSize: { height: 20, width: 40 },
  cssSize: { height: 20, width: 40 },
  devicePixelRatio: 2,
});
const owner = {};
const glyph = { height: 4, width: 2, xOffset: -1, yOffset: 2 };
const points: Quad = [
  { x: 8, y: 24 },
  { x: 8, y: 32 },
  { x: 12, y: 32 },
  { x: 12, y: 24 },
];
function text(): Extract<UiPaintCommand, { kind: "text" }> {
  return {
    alpha: 0.5,
    face: { family: "Fixture", role: "body", style: "normal", weight: "400" },
    glyphs: [uiGlyphPen({ baseline: 3 }, { glyph, quad: points, text: "A" })!],
    kind: "text",
    owner,
    size: 8,
    tint: [255, 255, 255],
    tintMode: "multiply",
  };
}
function glContext(data: number[]) {
  const gl = {
    FRAMEBUFFER_BINDING: 1,
    NO_ERROR: 0,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    drawingBufferHeight: 2,
    drawingBufferWidth: 1,
    getError: vi.fn(() => 0),
    getParameter: vi.fn(() => null as object | null),
    isContextLost: vi.fn(() => false),
    readPixels: vi.fn(
      (
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        _f: number,
        _t: number,
        output: Uint8Array,
      ) => output.set(data),
    ),
  };
  const context: UiWorldReadContext = {
    alphaMode: "premultiplied",
    captureSize: { height: 2, width: 1 },
    frameId: 5,
    gl: gl as unknown as WebGLRenderingContext,
    phase: "post-render",
  };
  return { context, gl };
}

describe("high-density UI kernel", () => {
  it("uses actual CSS/DPR backing with separate projection axes", () => {
    expect(
      uiProjection({
        captureSize: { height: 2, width: 3 },
        cssSize: { height: 4.25, width: 5.25 },
        devicePixelRatio: 1.5,
      }),
    ).toEqual({
      backingSize: { height: 7, width: 8 },
      captureSize: { height: 2, width: 3 },
      scaleX: 8 / 3,
      scaleY: 3.5,
    });
  });
  it("recovers signed-bearing pen and full rotated/scaled basis exactly once", () => {
    const rotated: Quad = [
      { x: 8, y: 18 },
      { x: -4, y: 18 },
      { x: -4, y: 22 },
      { x: 8, y: 22 },
    ];
    expect(uiGlyphPen({ baseline: 3 }, { glyph, quad: rotated, text: "A" })).toEqual({
      baseline: 3,
      pen: { x: 14, y: 20 },
      text: "A",
      transform: [0, 2, -3, 0],
    });
    expect(
      uiGlyphPen({ baseline: 3 }, { glyph: { ...glyph, width: 0 }, quad: points, text: " " }),
    ).toBeUndefined();
  });
  it("replays glyph pen, viewport and later panel in recorded order without measuring text", () => {
    const target = surface(80, 40);
    const fill: UiPaintCommand = {
      kind: "triangles",
      owner,
      vertices: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ].map((at) => ({ at, colour: [10, 20, 30, 0.5] as const })),
    };
    presentUi(
      {
        context: target.ctx,
        createSurface: vi.fn(),
        releaseSurface: vi.fn(),
        resizeBacking: vi.fn(),
      },
      {
        commands: [
          { camera: {}, kind: "viewport-clip", rect: { height: 10, width: 12, x: 2, y: 3 } },
          text(),
          fill,
        ],
        id: 1,
        projection,
      },
    );
    expect(target.operations).toEqual(["text", "fill"]);
    expect(target.context.rect).toHaveBeenCalledWith(2, 3, 12, 10);
    expect(target.context.setTransform).toHaveBeenCalledWith(4, 0, 0, 4, 20, 52);
    expect(target.context.fillText).toHaveBeenCalledWith("A", 0, 0);
    expect(target.context.fill).toHaveBeenCalledTimes(1);
    expect(target.ctx.globalAlpha).toBe(0.5);
  });
  it("reads the same default framebuffer synchronously and flips/unpremultiplies once", () => {
    const { context, gl } = glContext([0, 64, 0, 128, 32, 0, 0, 64]);
    const result = readUiWorldFrame(context, {
      area: { height: 2, width: 1, x: 0, y: 0 },
      frameId: 5,
    });
    expect(result.status).toBe("captured");
    if (result.status !== "captured") {
      throw new Error("Missing readback");
    }
    expect([...result.capture.pixels.data]).toEqual([127, 0, 0, 64, 0, 127, 0, 128]);
    expect(gl.readPixels).toHaveBeenCalledOnce();
  });
  it("refuses stale, non-default and lost-context reads before touching pixels", () => {
    const { context, gl } = glContext([]);
    const request = { area: { height: 2, width: 1, x: 0, y: 0 }, frameId: 5 };
    expect(readUiWorldFrame(context, { ...request, frameId: 6 })).toEqual({
      reason: "frame",
      status: "unavailable",
    });
    gl.getParameter.mockReturnValue({});
    expect(readUiWorldFrame(context, request)).toEqual({
      reason: "framebuffer",
      status: "unavailable",
    });
    gl.isContextLost.mockReturnValue(true);
    expect(readUiWorldFrame(context, request)).toEqual({
      reason: "context",
      status: "unavailable",
    });
    expect(gl.readPixels).not.toHaveBeenCalled();
  });
  it("excludes UI before composition, draws world then UI, remaps once and disposes", () => {
    const surfaces: ReturnType<typeof surface>[] = [];
    const remap = vi.fn();
    const compositor = createUiCompositor({
      captureWorld: ({ area, frameId }) => ({
        capture: {
          captureArea: area,
          frameId,
          pixels: { data: new Uint8Array(40 * 20 * 4), height: 20, width: 40 },
        },
        status: "captured",
      }),
      createSurface: ({ height, width }) => {
        const value = surface(width, height);
        surfaces.push(value);
        return value.ctx;
      },
      releaseSurface: vi.fn(),
      remap,
    });
    const frame: UiFrame = { commands: [text()], id: 1, projection };
    const request = {
      area: { height: 20, width: 40, x: 0, y: 0 },
      exclude: new Set([owner]),
      frame,
    };
    expect(compositor.capture(request).status).toBe("captured");
    expect(surfaces[1]!.context.fillText).not.toHaveBeenCalled();
    expect(surfaces[2]!.context.drawImage.mock.calls.map(([image]) => image)).toEqual([
      surfaces[0]!.canvas,
      surfaces[1]!.canvas,
    ]);
    expect(remap).toHaveBeenCalledOnce();
    compositor.destroy();
    expect(compositor.capture(request)).toEqual({ status: "disposed" });
  });
});
it("rejects independent WebGL2 read targets and readback errors without stale pixels", () => {
  const { context, gl } = glContext([]);
  Object.assign(gl, { READ_FRAMEBUFFER_BINDING: 4 });
  gl.getParameter.mockImplementation((...args: unknown[]) => (args[0] === 4 ? {} : null));
  const request = { area: { height: 2, width: 1, x: 0, y: 0 }, frameId: 5 };
  expect(readUiWorldFrame(context, request)).toEqual({
    reason: "framebuffer",
    status: "unavailable",
  });
  expect(gl.readPixels).not.toHaveBeenCalled();
  gl.getParameter.mockReturnValue(null);
  gl.readPixels.mockImplementation(() => {
    throw new Error("read unavailable");
  });
  expect(readUiWorldFrame(context, request)).toEqual({ reason: "readback", status: "unavailable" });
});
it("does not remap or allocate after reentrant compositor disposal", () => {
  const remap = vi.fn();
  const createSurface = vi.fn();
  const compositor = createUiCompositor({
    captureWorld: () => {
      compositor.destroy();
      return { reason: "context", status: "unavailable" };
    },
    createSurface,
    releaseSurface: vi.fn(),
    remap,
  });
  expect(
    compositor.capture({
      area: { height: 2, width: 1, x: 0, y: 0 },
      exclude: new Set(),
      frame: { commands: [], id: 1, projection },
    }),
  ).toEqual({ status: "disposed" });
  expect(createSurface).not.toHaveBeenCalled();
  expect(remap).not.toHaveBeenCalled();
});
it.each(["pre-existing", "readback"])("rejects nonthrowing %s GL errors", (phase) => {
  const { context, gl } = glContext([0, 0, 0, 0, 0, 0, 0, 0]);
  if (phase === "pre-existing") {
    gl.getError.mockReturnValueOnce(1282);
  } else {
    gl.getError.mockReturnValueOnce(0).mockReturnValueOnce(1282);
  }
  expect(
    readUiWorldFrame(context, {
      area: { height: 2, width: 1, x: 0, y: 0 },
      frameId: 5,
    }),
  ).toEqual({ reason: "readback", status: "unavailable" });
  expect(gl.readPixels).toHaveBeenCalledTimes(phase === "pre-existing" ? 0 : 1);
  expect(gl.getError).toHaveBeenCalledTimes(phase === "pre-existing" ? 1 : 2);
});

it("preserves the actual signed NineSlice UV mapping without an empty-raster failure", () => {
  const target = surface(80, 40);
  const image = {} as CanvasImageSource;
  const createSurface = vi.fn();
  const source = { height: -1.0000000000000167, width: 1, x: 1811, y: 960 };
  presentUi(
    { context: target.ctx, createSurface, releaseSurface: vi.fn(), resizeBacking: vi.fn() },
    {
      commands: [
        {
          alpha: 1,
          kind: "quad",
          owner,
          quad: [
            { x: 35, y: 1 },
            { x: 35, y: 0 },
            { x: 36, y: 0 },
            { x: 36, y: 1 },
          ],
          raster: { image, source },
          sampling: "nearest",
          tint: [255, 255, 255],
          tintMode: "multiply",
        },
      ],
      id: 1,
      projection,
    },
  );
  expect(target.context.drawImage).toHaveBeenCalledWith(
    image,
    1811,
    959,
    1,
    -source.height,
    0,
    0,
    1,
    -source.height,
  );
  expect(target.context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2 / -source.height, 70, 0);
  expect(target.ctx.imageSmoothingEnabled).toBe(false);
  expect(createSurface).not.toHaveBeenCalled();
  expect(source.height).toBe(-1.0000000000000167);
});
it.each([
  [1, 1, "multiply"],
  [-1, 1, "fill"],
  [1, -1, "fill"],
  [-1, -1, "multiply"],
] as const)(
  "maps signed raster axes %s/%s through %s tint without losing alpha",
  (xSign, ySign, tintMode) => {
    const target = surface(80, 40);
    const scratch = surface(1, 1);
    const image = { pixels: new Uint8ClampedArray([80, 160, 240, 128]) };
    const release = vi.fn();
    presentUi(
      {
        context: target.ctx,
        createSurface: () => scratch.ctx,
        releaseSurface: release,
        resizeBacking: vi.fn(),
      },
      {
        commands: [
          {
            alpha: 0.45,
            kind: "quad",
            owner,
            quad: points,
            raster: {
              image: image as unknown as CanvasImageSource,
              source: { height: ySign, width: xSign, x: 5, y: 6 },
            },
            sampling: "nearest",
            tint: [128, 128, 128],
            tintMode,
          },
        ],
        id: 1,
        projection,
      },
    );
    expect(scratch.context.drawImage).toHaveBeenCalledWith(
      image,
      xSign < 0 ? 4 : 5,
      ySign < 0 ? 5 : 6,
      1,
      1,
      0,
      0,
      1,
      1,
    );
    expect(target.context.setTransform).toHaveBeenCalledWith(
      xSign * 8,
      0,
      0,
      ySign * 16,
      xSign < 0 ? 24 : 16,
      ySign < 0 ? 64 : 48,
    );
    expect([...scratch.canvas.pixels]).toEqual(
      tintMode === "fill" ? [128, 128, 128, 128] : [40, 80, 120, 128],
    );
    expect(target.ctx.globalAlpha).toBe(0.45);
    expect(release).toHaveBeenCalledWith(scratch.ctx);
  },
);
it("skips finite zero-ink quads but rejects invalid or nondegenerate zero-span raster mappings", () => {
  const target = surface(80, 40);
  const createSurface = vi.fn();
  const command: Extract<UiPaintCommand, { kind: "quad" }> = {
    alpha: 1,
    kind: "quad",
    owner,
    quad: points,
    raster: { image: {} as CanvasImageSource, source: { height: 1, width: 0, x: 0, y: 0 } },
    sampling: "nearest",
    tint: [255, 255, 255],
    tintMode: "multiply",
  };
  const paint = (next: typeof command) =>
    presentUi(
      { context: target.ctx, createSurface, releaseSurface: vi.fn(), resizeBacking: vi.fn() },
      { commands: [next], id: 1, projection },
    );
  expect(() => paint(command)).toThrow("zero spans");
  expect(() =>
    paint({ ...command, quad: [points[0], points[1], points[1], points[0]] }),
  ).not.toThrow();
  expect(() =>
    paint({
      ...command,
      raster: { ...command.raster, source: { height: 1, width: Number.NaN, x: 0, y: 0 } },
    }),
  ).toThrow("finite geometry");
  expect(() =>
    paint({
      ...command,
      quad: [{ x: Number.POSITIVE_INFINITY, y: 0 }, points[1], points[1], points[0]],
    }),
  ).toThrow("finite geometry");
  expect(target.context.drawImage).not.toHaveBeenCalled();
  expect(createSurface).not.toHaveBeenCalled();
});

type QuadCommand = Extract<UiPaintCommand, { kind: "quad" }>;
describe("tinted raster cache", () => {
  class FakeBitmap {
    pixels = new Uint8ClampedArray([80, 160, 240, 128]);
    width: number;
    constructor(width: number) {
      this.width = width;
    }
  }
  class FakeImage {
    complete = true;
    currentSrc = "atlas.png";
    naturalWidth = 1;
    pixels = new Uint8ClampedArray([80, 160, 240, 128]);
  }
  beforeEach(() => {
    vi.stubGlobal("ImageBitmap", FakeBitmap);
    vi.stubGlobal("HTMLImageElement", FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const unit = { height: 1, width: 1, x: 5, y: 6 };
  function tinted(image: object, patch: Partial<QuadCommand> = {}, source = unit): QuadCommand {
    return {
      alpha: 0.45,
      kind: "quad",
      owner,
      quad: points,
      raster: { image: image as CanvasImageSource, source },
      sampling: "nearest",
      tint: [128, 128, 128],
      tintMode: "multiply",
      ...patch,
    };
  }
  function host() {
    const target = surface(80, 40);
    const scratches: ReturnType<typeof surface>[] = [];
    const ports = {
      context: target.ctx,
      createSurface: vi.fn(({ height, width }: { height: number; width: number }) => {
        const value = surface(width, height);
        scratches.push(value);
        return value.ctx;
      }),
      releaseSurface: vi.fn(),
      resizeBacking: vi.fn(),
    };
    const paint = (command: UiPaintCommand) =>
      presentUi(ports, { commands: [command], id: 1, projection });
    return { paint, ports, scratches, target };
  }
  const incomplete = () => Object.assign(new FakeImage(), { complete: false });
  it.each([
    ["a live ImageBitmap", () => new FakeBitmap(1), true],
    ["a loaded HTMLImageElement", () => new FakeImage(), true],
    ["a closed ImageBitmap", () => new FakeBitmap(0), false],
    ["an incomplete HTMLImageElement", incomplete, false],
    ["a canvas", () => ({ height: 1, pixels: new FakeImage().pixels, width: 1 }), false],
  ] as const)("caches the tint of %s only when its pixels are immutable", (_, make, cacheable) => {
    const { paint, ports, scratches, target } = host();
    const image = make();
    paint(tinted(image));
    paint(tinted(image));
    const made = cacheable ? [scratches[0]!] : [scratches[0]!, scratches[1]!];
    expect(scratches).toEqual(made);
    expect(made.map((scratch) => scratch.context.getImageData.mock.calls.length)).toEqual(
      made.map(() => 1),
    );
    expect([...scratches[0]!.canvas.pixels]).toEqual([40, 80, 120, 128]);
    expect(target.context.drawImage.mock.calls.map(([drawn]) => drawn)).toEqual(
      cacheable ? [made[0]!.canvas, made[0]!.canvas] : made.map((scratch) => scratch.canvas),
    );
    expect(target.context.setTransform.mock.calls.slice(-1)).toEqual([[8, 0, 0, 16, 16, 48]]);
    expect(ports.releaseSurface.mock.calls).toEqual(cacheable ? [] : made.map((s) => [s.ctx]));
    releaseUiTintCache(ports);
    expect(ports.releaseSurface.mock.calls).toEqual(made.map((scratch) => [scratch.ctx]));
  });
  it.each([
    ["tint", { tint: [128, 128, 127] }, unit],
    ["tint mode", { tintMode: "fill" }, unit],
    ["source rect", {}, { ...unit, x: 6 }],
  ] as const)("keys the cache by %s", (_, patch, source) => {
    const { paint, ports, scratches } = host();
    const image = new FakeBitmap(1);
    paint(tinted(image));
    paint(tinted(image, patch, source));
    paint(tinted(image, patch, source));
    expect(ports.createSurface).toHaveBeenCalledTimes(2);
    expect(ports.releaseSurface).not.toHaveBeenCalled();
    releaseUiTintCache(ports);
    expect(ports.releaseSurface.mock.calls).toEqual([[scratches[0]!.ctx], [scratches[1]!.ctx]]);
  });
  it("replaces an HTMLImageElement entry when its current source changes", () => {
    const { paint, ports, scratches } = host();
    const image = new FakeImage();
    paint(tinted(image));
    image.currentSrc = "other.png";
    paint(tinted(image));
    paint(tinted(image));
    expect(ports.createSurface).toHaveBeenCalledTimes(2);
    expect(ports.releaseSurface.mock.calls).toEqual([[scratches[0]!.ctx]]);
    releaseUiTintCache(ports);
    expect(ports.releaseSurface.mock.calls).toEqual([[scratches[0]!.ctx], [scratches[1]!.ctx]]);
  });
  it("evicts the least recently used entry beyond 256 entries", () => {
    const { paint, ports, scratches } = host();
    const image = new FakeBitmap(1);
    const tints = Array.from({ length: 257 }, (_, i) => [i % 256, i >> 8, 0] as const);
    paint(tinted(image, { tint: tints[0]! }));
    paint(tinted(image, { tint: tints[1]! }));
    paint(tinted(image, { tint: tints[0]! }));
    for (const tint of tints.slice(2)) {
      paint(tinted(image, { tint }));
    }
    expect(ports.createSurface).toHaveBeenCalledTimes(257);
    expect(ports.releaseSurface.mock.calls).toEqual([[scratches[1]!.ctx]]);
    releaseUiTintCache(ports);
    expect(ports.releaseSurface).toHaveBeenCalledTimes(257);
  });
  it("releases a surface larger than the pixel budget instead of retaining it", () => {
    const { paint, ports, scratches } = host();
    paint(tinted(new FakeBitmap(1), {}, { height: 2049, width: 2048, x: 0, y: 0 }));
    expect(ports.releaseSurface.mock.calls).toEqual([[scratches[0]!.ctx]]);
  });
});
it("paints a batched glyph run like one command per glyph behind repeated clips", () => {
  const clip: UiPaintCommand = {
    camera: {},
    kind: "viewport-clip",
    rect: { height: 10, width: 12, x: 2, y: 3 },
  };
  const moved = points.map(({ x, y }) => ({ x: x + 4, y })) as unknown as Quad;
  const second = uiGlyphPen({ baseline: 3 }, { glyph, quad: moved, text: "B" })!;
  const single = (pen: typeof second): UiPaintCommand => ({ ...text(), glyphs: [pen] });
  const paint = (commands: UiPaintCommand[]) => {
    const target = surface(80, 40);
    let transform: number[] = [];
    const log: unknown[] = [];
    Object.assign(target.context, {
      fillText: (value: string) => {
        const { fillStyle, font, globalAlpha } = target.ctx;
        log.push([value, transform, font, fillStyle, globalAlpha]);
      },
      setTransform: (...args: number[]) => {
        transform = args;
      },
    });
    presentUi(
      {
        context: target.ctx,
        createSurface: vi.fn(),
        releaseSurface: vi.fn(),
        resizeBacking: vi.fn(),
      },
      { commands, id: 1, projection },
    );
    return { clips: target.context.rect.mock.calls, log };
  };
  const first = text().glyphs[0]!;
  const batched = paint([clip, { ...text(), glyphs: [first, second] }]);
  const unbatched = paint([clip, single(first), clip, single(second)]);
  expect(batched.log).toEqual(unbatched.log);
  expect(batched.log).toHaveLength(2);
  expect(batched.clips).toEqual([[2, 3, 12, 10]]);
  expect(unbatched.clips).toEqual([
    [2, 3, 12, 10],
    [2, 3, 12, 10],
  ]);
});
