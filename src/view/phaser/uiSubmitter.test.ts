import type { GameObjects, Renderer } from "phaser";
import { expect, it, vi } from "vitest";

import type { UiCapturePorts } from "./uiCommands.ts";
import { uiProjection } from "./uiProjection.ts";
import { createUiRecorder } from "./uiSubmitter.ts";

vi.mock("phaser", () => ({
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
}));

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
