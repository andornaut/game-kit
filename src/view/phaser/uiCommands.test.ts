import { describe, expect, it, vi } from "vitest";

import { uiGlyphPen } from "../../text/phaser/uiGlyphPen.ts";
import {
  presentUi,
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
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    drawingBufferHeight: 2,
    drawingBufferWidth: 1,
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
  it.each(["fill", "multiply"] as const)(
    "preserves source alpha for %s raster tint",
    (tintMode) => {
      const target = surface(80, 40);
      const scratch = surface(1, 1);
      const source = { pixels: new Uint8ClampedArray([80, 160, 240, 128]) };
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
                image: source as unknown as CanvasImageSource,
                source: { height: 1, width: 1, x: 0, y: 0 },
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
      expect([...scratch.canvas.pixels]).toEqual(
        tintMode === "fill" ? [128, 128, 128, 128] : [40, 80, 120, 128],
      );
      expect(target.ctx.globalAlpha).toBe(0.45);
      expect(release).toHaveBeenCalledWith(scratch.ctx);
    },
  );
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
it("uses the original raster directly for untinted MULTIPLY without scratch allocation", () => {
  const target = surface(80, 40);
  const createSurface = vi.fn();
  const image = {} as CanvasImageSource;
  presentUi(
    { context: target.ctx, createSurface, releaseSurface: vi.fn(), resizeBacking: vi.fn() },
    {
      commands: [
        {
          alpha: 0.5,
          kind: "quad",
          owner,
          quad: points,
          raster: { image, source: { height: 4, width: 2, x: 5, y: 6 } },
          sampling: "nearest",
          tint: [255, 255, 255],
          tintMode: "multiply",
        },
      ],
      id: 1,
      projection,
    },
  );
  expect(createSurface).not.toHaveBeenCalled();
  expect(target.context.drawImage).toHaveBeenCalledWith(image, 5, 6, 2, 4, 0, 0, 2, 4);
});
