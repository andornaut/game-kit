import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { BlendModes, type GameObjects, type Renderer, ScaleModes, TintModes } from "phaser";
import { expect, it, vi } from "vitest";

import type { UiCapturePorts, UiFrame } from "./uiCommands.ts";
import { uiProjection } from "./uiProjection.ts";
import { createUiRecorder } from "./uiSubmitter.ts";

vi.mock("phaser", async () => {
  const nodeModule = await import("node:module");
  const path = await import("node:path");
  const load = nodeModule.createRequire(import.meta.url);
  const root = path.dirname(load.resolve("phaser/package.json"));
  // The real constant modules, so tests compare against Phaser values rather than copies.
  const constants = (name: string) => load(path.join(root, "src/renderer", `${name}.js`));
  return {
    BlendModes: constants("BlendModes"),
    Renderer: {
      WebGL: {
        RenderNodes: {
          RenderNode: class {
            name: string;
            constructor(name: string) {
              this.name = name;
            }
          },
        },
      },
    },
    ScaleModes: constants("ScaleModes"),
    TintModes: constants("TintModes"),
  };
});

type Role = { name: string; run(...args: unknown[]): void; batch(...args: unknown[]): void };
function object(type: string) {
  const frame = { source: { scaleMode: 1 }, u0: 0, u1: 1, v0: 0, v1: 1 };
  const customRenderNodes: Record<string, Role | undefined> = {};
  const renderNodeData: Record<string, object> = {};
  const value = {
    alpha: 1,
    blendMode: 0,
    customRenderNodes,
    frame,
    renderNodeData,
    scene: { sys: { renderer: { renderNodes: {} } } },
    setRenderNodeRole: vi.fn((role: string, node: Role | null, data?: object) => {
      if (node) {
        customRenderNodes[role] = node;
        renderNodeData[node.name] = data ?? {};
      } else {
        const previous = customRenderNodes[role];
        if (previous) {
          delete renderNodeData[previous.name];
        }
        delete customRenderNodes[role];
      }
    }),
    type,
  };
  return { node: value as unknown as GameObjects.GameObject, value };
}
const projection = uiProjection({
  captureSize: { height: 20, width: 40 },
  cssSize: { height: 20, width: 40 },
  devicePixelRatio: 2,
});
function ports(fontsReady: Promise<void> = Promise.resolve()): UiCapturePorts {
  return {
    fontsReady,
    image: () => ({
      image: {} as CanvasImageSource,
      source: { height: 8, width: 8, x: 0, y: 0 },
    }),
    textStyle: () => ({
      baseline: 3,
      face: { family: "Fixture", role: "body", style: "normal", weight: "400" },
      size: 8,
    }),
    viewport: () => ({ height: 10, width: 12, x: 2, y: 3 }),
  };
}
const context = {
  camera: { alpha: 1 },
  useCanvas: true,
} as unknown as Renderer.WebGL.DrawingContext;

it("keeps font-pending groups untouched and ignores readiness after disposal", async () => {
  let ready = () => {};
  const recorder = createUiRecorder(
    ports(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    ),
  );
  const image = object("Image");
  expect(recorder.register([image.node])).toEqual({ reason: "fonts-pending", status: "not-ready" });
  recorder.destroy();
  ready();
  await Promise.resolve();
  expect(recorder.register([image.node]).status).toBe("unsupported");
  expect(image.value.setRenderNodeRole).not.toHaveBeenCalled();
});
it("registers siblings atomically, rejects unsupported refresh and restores owned roles only", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const image = object("Image");
  const panel = object("NineSlice");
  const invalid = object("Mesh");
  expect(recorder.register([image.node, invalid.node]).status).toBe("unsupported");
  expect(image.value.setRenderNodeRole).not.toHaveBeenCalled();
  const registered = recorder.register([image.node, panel.node]);
  if (registered.status !== "ready") {
    throw new Error("Missing registration");
  }
  expect(panel.value.customRenderNodes.BatchHandler).toBeDefined();
  expect(registered.handle.refresh([image.node, invalid.node]).status).toBe("unsupported");
  expect(image.value.customRenderNodes).toEqual({});
  expect(panel.value.customRenderNodes).toEqual({});
  expect(registered.handle.refresh([image.node]).status).toBe("ready");
  const peer = { batch() {}, name: "peer", run() {} };
  image.value.customRenderNodes.BatchHandler = peer;
  registered.handle.destroy();
  expect(image.value.customRenderNodes.BatchHandler).toBe(peer);
});
it("copies NineSlice batch quads, real FILL/alpha and viewport before ordered paint", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const panel = object("NineSlice");
  const result = recorder.register([panel.node]);
  expect(result.status).toBe("ready");
  recorder.begin(7, projection);
  panel.value.customRenderNodes.BatchHandler!.batch(
    context,
    {},
    0,
    0,
    0,
    8,
    8,
    0,
    8,
    8,
    0,
    0,
    1,
    1,
    1,
    0x80ff0000,
    0x80ff0000,
    0x80ff0000,
    0x80ff0000,
    {},
  );
  const frame = recorder.finish();
  expect(frame.commands.map((command) => command.kind)).toEqual(["viewport-clip", "quad"]);
  expect(frame.commands[1]).toMatchObject({
    alpha: 128 / 255,
    sampling: "nearest",
    tint: [255, 0, 0],
    tintMode: "fill",
  });
  recorder.destroy();
});
it("captures text via public glyph identity and already-transformed quad without relayout", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const text = object("BitmapText");
  const glyph = { height: 4, width: 2, xOffset: -1, yOffset: 2 };
  Object.assign(text.value, { fontData: { chars: { 65: glyph }, size: 8 } });
  expect(recorder.register([text.node]).status).toBe("ready");
  recorder.begin(1, projection);
  const points = new Float32Array([8, 24, 8, 32, 12, 32, 12, 24]);
  text.value.customRenderNodes.Submitter!.run(
    context,
    text.value,
    undefined,
    0,
    { uvSource: glyph },
    { quad: points },
    {
      tintBottomLeft: 0xffffffff,
      tintBottomRight: 0xffffffff,
      tintEffect: 0,
      tintTopLeft: 0xffffffff,
      tintTopRight: 0xffffffff,
    },
  );
  points.fill(0);
  expect(recorder.finish().commands[1]).toMatchObject({
    glyphs: [{ baseline: 3, pen: { x: 10, y: 20 }, text: "A", transform: [2, 0, 0, 2] }],
    size: 8,
  });
  recorder.destroy();
});
const white = {
  tintBottomLeft: 0xffffffff,
  tintBottomRight: 0xffffffff,
  tintEffect: 0,
  tintTopLeft: 0xffffffff,
  tintTopRight: 0xffffffff,
};
const metrics = { height: 4, width: 2, xOffset: -1, yOffset: 2 };
type Key = "a" | "b";
function glyphText(frame: UiFrame): string {
  return frame.commands
    .flatMap((command) => (command.kind === "text" ? command.glyphs : []))
    .map((glyph) => glyph.text)
    .join("");
}
function drawGlyph(text: ReturnType<typeof object>, glyph: object, colours: object = white) {
  text.value.customRenderNodes.Submitter!.run(
    context,
    text.value,
    undefined,
    0,
    { uvSource: glyph },
    { quad: new Float32Array([8, 24, 8, 32, 12, 32, 12, 24]) },
    colours,
  );
}
it.each([
  ["the first code of a shared glyph", { 65: "a", 66: "a" }, ["a", "a"], undefined, "AA"],
  ["a glyph added after indexing", { 65: "a" }, ["a", "b"], { 66: "b" }, "AB"],
] as const)("resolves %s", async (_, chars, draws, added, expected) => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const text = object("BitmapText");
  const glyphs = { a: { ...metrics }, b: { ...metrics } };
  const fontChars: Record<number, object> = Object.fromEntries(
    Object.entries(chars as Record<number, Key>).map(([code, key]) => [code, glyphs[key]]),
  );
  Object.assign(text.value, { fontData: { chars: fontChars, size: 8 } });
  expect(recorder.register([text.node]).status).toBe("ready");
  recorder.begin(1, projection);
  drawGlyph(text, glyphs[draws[0]]);
  for (const [code, key] of Object.entries((added ?? {}) as Record<number, Key>)) {
    fontChars[Number(code)] = glyphs[key];
  }
  drawGlyph(text, glyphs[draws[1]]);
  expect(glyphText(recorder.finish())).toBe(expected);
  recorder.destroy();
});
it("fails the group and restores its roles when a glyph is not in the font", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const text = object("BitmapText");
  Object.assign(text.value, { fontData: { chars: { 65: {} }, size: 8 } });
  expect(recorder.register([text.node]).status).toBe("ready");
  recorder.begin(1, projection);
  expect(() => drawGlyph(text, { ...metrics })).toThrow("UI group capture unavailable: font");
  expect(text.value.customRenderNodes).toEqual({});
  recorder.destroy();
});
async function registered(kind: string) {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const value = object(kind);
  const registration = recorder.register([value.node]);
  if (registration.status !== "ready") {
    throw new Error("Missing registration");
  }
  return { owner: registration.handle.owner, recorder, value };
}
it.each([
  [TintModes.MULTIPLY, ScaleModes.LINEAR, 0x80ff0000, [255, 0, 0], 128 / 255, "multiply", "linear"],
  [TintModes.FILL, ScaleModes.NEAREST, 0xff102030, [16, 32, 48], 1, "fill", "nearest"],
] as const)(
  "maps quad batch args by index with tint mode %s and scale mode %s",
  async (tintMode, scaleMode, colour, tint, alpha, mode, sampling) => {
    const { owner, recorder, value } = await registered("Image");
    Object.assign(value.frame, { u0: 0.25, u1: 0.75, v0: 0, v1: 0.5 });
    value.frame.source.scaleMode = scaleMode;
    recorder.begin(1, projection);
    const corners = [1, 2, 3, 4, 5, 6, 7, 8];
    const uv = [0.5, 0.25, 0.25, -0.25];
    value.customRenderNodes.BatchHandler!.batch(
      context,
      {},
      ...corners,
      ...uv,
      tintMode,
      ...[colour, colour, colour, colour],
      {},
    );
    expect(recorder.finish().commands[1]).toEqual({
      alpha,
      kind: "quad",
      owner,
      quad: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 7, y: 8 },
        { x: 5, y: 6 },
      ],
      raster: { image: {}, source: { height: -4, width: 4, x: 4, y: 4 } },
      sampling,
      tint,
      tintMode: mode,
    });
    recorder.destroy();
  },
);
it("shares one frozen colour tuple across every triangle vertex of a command", async () => {
  const { owner, recorder, value } = await registered("Rectangle");
  recorder.begin(1, projection);
  const positions = [0, 0, 4, 0, 4, 4, 0, 4];
  value.customRenderNodes.Submitter!.batch(
    context,
    [0, 1, 2, 0, 2, 3],
    positions,
    Array(4).fill(0x40102030),
    false,
  );
  const command = recorder.finish().commands[1]!;
  if (command.kind !== "triangles") {
    throw new Error("Missing triangles");
  }
  const colour = [16, 32, 48, 64 / 255];
  expect(command).toEqual({
    kind: "triangles",
    owner,
    vertices: [0, 1, 2, 0, 2, 3].map((index) => ({
      at: { x: positions[index * 2], y: positions[index * 2 + 1] },
      colour,
    })),
  });
  expect(new Set(command.vertices.map((vertex) => vertex.colour)).size).toBe(1);
  expect(Object.isFrozen(command.vertices[0]!.colour)).toBe(true);
  recorder.destroy();
});
it.each([
  ["triangles", "Rectangle", "Submitter"],
  ["quad", "Image", "BatchHandler"],
] as const)("fails %s with non-uniform corner colours", async (_, kind, role) => {
  const { recorder, value } = await registered(kind);
  recorder.begin(1, projection);
  const node = value.customRenderNodes[role]!;
  const draw =
    kind === "Rectangle"
      ? () => node.batch(context, [0, 1, 2], [0, 0, 1, 0, 1, 1], [1, 1, 2], false)
      : () => node.batch(context, {}, ...Array(12).fill(0), 0, 1, 1, 2, 1, {});
  expect(draw).toThrow("UI group capture unavailable: effect");
  expect(value.customRenderNodes).toEqual({});
  recorder.destroy();
});
it("preflights Graphics opcodes rather than mistaking operand values for gradients", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const shape = object("Graphics");
  Object.assign(shape.value, { commandBuffer: [7, 0xffffff, 0.5, 3, 21, 22, 8, 8] });
  const result = recorder.register([shape.node]);
  if (result.status !== "ready") {
    throw new Error("Uniform Graphics refused");
  }
  recorder.begin(1, projection);
  const positions = [0, 0, 2, 0, 2, 2];
  shape.value.customRenderNodes.Submitter!.batch(
    context,
    [0, 1, 2],
    positions,
    [0x7fffffff, 0x7fffffff, 0x7fffffff],
    false,
  );
  positions.fill(99);
  expect(recorder.finish().commands[1]).toMatchObject({
    kind: "triangles",
    vertices: [
      { at: { x: 0, y: 0 }, colour: [255, 255, 255, 127 / 255] },
      { at: { x: 2, y: 0 } },
      { at: { x: 2, y: 2 } },
    ],
  });
  Object.assign(shape.value, { commandBuffer: [21] });
  expect(result.handle.refresh().status).toBe("unsupported");
  expect(shape.value.customRenderNodes).toEqual({});
  recorder.destroy();
});
it.each([
  ["Image", { blendMode: BlendModes.NORMAL }, []],
  ["Image", { blendMode: BlendModes.ADD }, ["blend"]],
  ["Image", { blendMode: BlendModes.SKIP_CHECK }, ["blend"]],
  ["Container", { blendMode: BlendModes.SKIP_CHECK }, []],
  ["Image", { tintMode: TintModes.MULTIPLY }, []],
  ["Image", { tintMode: TintModes.FILL }, []],
  ["Image", { tintMode: TintModes.ADD }, ["effect"]],
] as const)("checks %s %o against Phaser constants", async (kind, patch, reasons) => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const leaf = object("Image");
  const root = kind === "Container" ? object("Container") : leaf;
  if (root !== leaf) {
    Object.assign(root.value, { list: [leaf.node] });
  }
  Object.assign(root.value, patch);
  const result = recorder.register([root.node]);
  expect(result.status).toBe(reasons.length ? "unsupported" : "ready");
  const issues = result.status === "unsupported" ? result.issues : [];
  expect(issues.map((issue) => issue.reason)).toEqual(reasons);
  recorder.destroy();
});
it("never overwrites a peer's replacement role during refresh", async () => {
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const image = object("Image");
  const result = recorder.register([image.node]);
  if (result.status !== "ready") {
    throw new Error("Missing group");
  }
  const peer = { batch() {}, name: "peer", run() {} };
  image.value.customRenderNodes.BatchHandler = peer;
  expect(result.handle.refresh().status).toBe("unsupported");
  expect(image.value.customRenderNodes.BatchHandler).toBe(peer);
  recorder.destroy();
});

it.each(["gradient", "tint-effect", "font-size"])(
  "rejects %s text before installing any sibling role and rolls back refresh",
  async (failure) => {
    const recorder = createUiRecorder(ports());
    await Promise.resolve();
    const image = object("Image");
    const text = object("BitmapText");
    const fontData = { chars: {}, size: 8 };
    const colour = { tintBL: 1, tintBR: 1, tintEffect: 0, tintTL: 1, tintTR: 1 };
    Object.assign(text.value, { charColors: { 0: colour }, fontData });
    const makeInvalid = () => {
      if (failure === "gradient") {
        colour.tintTR = 2;
      }
      if (failure === "tint-effect") {
        colour.tintEffect = 2;
      }
      if (failure === "font-size") {
        fontData.size = 16;
      }
    };
    makeInvalid();
    expect(recorder.register([image.node, text.node]).status).toBe("unsupported");
    expect(image.value.setRenderNodeRole).not.toHaveBeenCalled();
    expect(text.value.setRenderNodeRole).not.toHaveBeenCalled();
    colour.tintTR = 1;
    colour.tintEffect = 0;
    fontData.size = 8;
    const registered = recorder.register([image.node, text.node]);
    if (registered.status !== "ready") {
      throw new Error("Missing registration");
    }
    makeInvalid();
    expect(registered.handle.refresh().status).toBe("unsupported");
    expect(image.value.customRenderNodes).toEqual({});
    expect(text.value.customRenderNodes).toEqual({});
  },
);

it("refreshes and disposes after actual Phaser object destruction without touching dead scenes", async () => {
  const load = createRequire(import.meta.url);
  const root = dirname(load.resolve("phaser/package.json"));
  const components = join(root, "src/gameobjects/components/index.js");
  const previous = load.cache[components];
  // Renderer mixins are outside this lifecycle test; the object and destroy method are real.
  load.cache[components] = { exports: { Filters: {}, RenderSteps: {} } } as NodeModule;
  let RealObject: new (scene: unknown, type: string) => GameObjects.GameObject;
  try {
    RealObject = load(join(root, "src/gameobjects/GameObject.js"));
  } finally {
    if (previous) {
      load.cache[components] = previous;
    } else {
      delete load.cache[components];
    }
  }
  const roles = load(join(root, "src/gameobjects/components/RenderNodes.js"));
  const real = () => {
    const value = new RealObject(
      { sys: { queueDepthSort() {}, renderer: { renderNodes: {} } } },
      "NineSlice",
    );
    return Object.assign(value, {
      customRenderNodes: {} as Record<string, Role | undefined>,
      frame: object("NineSlice").value.frame,
      renderNodeData: {} as Record<string, object>,
      setRenderNodeRole: vi.fn(roles.setRenderNodeRole),
    });
  };
  const recorder = createUiRecorder(ports());
  await Promise.resolve();
  const old = real();
  const registration = recorder.register([old]);
  if (registration.status !== "ready") {
    throw new Error("Missing registration");
  }
  const owned = old.customRenderNodes.BatchHandler!;
  old.destroy();
  expect(old.scene).toBeUndefined();
  expect(old.isDestroyed).toBe(true);
  expect(old.customRenderNodes.BatchHandler).toBe(owned);
  const calls = old.setRenderNodeRole.mock.calls.length;
  const next = real();
  expect(registration.handle.refresh([next]).status).toBe("ready");
  expect(old.setRenderNodeRole).toHaveBeenCalledTimes(calls);
  expect(old.customRenderNodes).toEqual({});
  expect(old.renderNodeData[owned.name]).toBeUndefined();
  expect(next.customRenderNodes.BatchHandler).toBeDefined();
  next.destroy();
  expect(() => recorder.destroy()).not.toThrow();
  expect(next.customRenderNodes).toEqual({});
  expect(next.renderNodeData).toEqual({});
});
