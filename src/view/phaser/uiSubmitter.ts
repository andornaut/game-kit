import { type GameObjects, Renderer, type Scene, type Textures } from "phaser";

import { uiGlyphPen } from "../../text/phaser/uiGlyphPen.ts";
import type {
  Colour,
  Owner,
  Quad,
  UiCapturePorts,
  UiFrame,
  UiIssue,
  UiPaintCommand,
  UiProjection,
  UiRaster,
  UiRefreshResult,
  UiRegistration,
  UiRootHandle,
} from "./uiCommands.ts";

type Node = Renderer.WebGL.RenderNodes.RenderNode;
type Context = Renderer.WebGL.DrawingContext;
type ObjectView = GameObjects.GameObject & {
  alpha?: number;
  alphaTopLeft?: number;
  alphaTopRight?: number;
  alphaBottomLeft?: number;
  alphaBottomRight?: number;
  blendMode?: number;
  mask?: unknown;
  filters?: { internal: { getActive(): unknown[] }; external: { getActive(): unknown[] } } | null;
  tintMode?: number;
  tintTopLeft?: number;
  tintTopRight?: number;
  tintBottomLeft?: number;
  tintBottomRight?: number;
  frame?: Textures.Frame;
  commandBuffer?: number[];
  charColors?: Record<
    number,
    | {
        tintEffect: number;
        tintTL: number;
        tintTR: number;
        tintBL: number;
        tintBR: number;
      }
    | undefined
  >;
  list?: GameObjects.GameObject[];
  lighting?: unknown;
  dropShadowX?: number;
  dropShadowY?: number;
  scene: Scene;
  customRenderNodes?: Record<string, Node | undefined>;
  defaultRenderNodes?: Record<string, Node | undefined>;
  renderNodeData?: Record<string, unknown>;
  setRenderNodeRole?(role: string, node: Node | null, data?: object): unknown;
};
interface SavedRole {
  object: ObjectView;
  role: string;
  node: CaptureNode;
  previous: Node | undefined;
  data: object | undefined;
}
interface Group {
  owner: Owner;
  members: Set<GameObjects.GameObject>;
  roots: readonly GameObjects.GameObject[];
  saved: SavedRole[];
  dead: boolean;
}
class CaptureNode extends Renderer.WebGL.RenderNodes.RenderNode {
  constructor(
    manager: Renderer.WebGL.RenderNodes.RenderNodeManager,
    private readonly receive: (method: "run" | "batch", args: unknown[]) => void,
  ) {
    super("GameKitUiCapture", manager);
  }
  override run(...args: unknown[]): void {
    this.receive("run", args);
  }
  batch(...args: unknown[]): void {
    this.receive("batch", args);
  }
}
function renderManager(
  object: ObjectView,
): Renderer.WebGL.RenderNodes.RenderNodeManager | undefined {
  const renderer = object.scene.sys.renderer;
  return renderer && "renderNodes" in renderer ? renderer.renderNodes : undefined;
}
const kinds = new Set([
  "NineSlice",
  "Image",
  "Sprite",
  "BitmapText",
  "Rectangle",
  "Graphics",
  "Container",
]);
// Operand counts of Phaser 4.2's public Graphics.commandBuffer. Gradient opcodes are refused.
const operands: readonly (number | undefined)[] = [
  7,
  0,
  0,
  4,
  2,
  2,
  3,
  2,
  0,
  0,
  6,
  6,
  undefined,
  undefined,
  0,
  0,
  2,
  2,
  1,
];
function uniform(values: readonly unknown[]): boolean {
  return values.every((value) => value === values[0]);
}
function packed(value: number): Colour {
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255, (value >>> 24) / 255];
}
function quad(values: ArrayLike<number>): Quad {
  return [0, 2, 4, 6].map((i) => ({ x: values[i]!, y: values[i + 1]! })) as unknown as Quad;
}
function graphicsSupported(commands: readonly number[]): boolean {
  for (let i = 0; i < commands.length;) {
    const count = operands[commands[i++]!];
    if (count === undefined || i + count > commands.length) {
      return false;
    }
    i += count;
  }
  return true;
}

export function createUiRecorder(ports: UiCapturePorts): {
  register(roots: readonly GameObjects.GameObject[]): UiRegistration;
  begin(frameId: number, projection: UiProjection): void;
  finish(): UiFrame;
  destroy(): void;
} {
  const groups = new Set<Group>();
  let fontState: "pending" | "ready" | "failed" = "pending";
  let disposed = false;
  let frame: { id: number; projection: UiProjection; commands: UiPaintCommand[] } | undefined;
  void ports.fontsReady.then(
    () => {
      if (!disposed) {
        fontState = "ready";
      }
    },
    () => {
      if (!disposed) {
        fontState = "failed";
      }
    },
  );
  const restore = (group: Group) => {
    for (const saved of group.saved.reverse()) {
      if (saved.object.customRenderNodes?.[saved.role] === saved.node) {
        saved.object.setRenderNodeRole!(saved.role, null);
        if (saved.previous) {
          saved.object.setRenderNodeRole!(saved.role, saved.previous, saved.data);
        }
      }
    }
    group.saved = [];
    group.members.clear();
    if (frame) {
      frame.commands = frame.commands.filter(
        (c) => c.kind === "viewport-clip" || c.owner !== group.owner,
      );
    }
  };
  const fail = (group: Group, reason: UiIssue["reason"]): never => {
    restore(group);
    throw new Error(`UI group capture unavailable: ${reason}`);
  };
  const append = (group: Group, context: Context, command: UiPaintCommand) => {
    if (!frame || disposed || group.dead) {
      fail(group, "renderer");
    }
    const camera = context.camera;
    if (!context.useCanvas || !camera || camera.alpha !== 1) {
      return fail(group, "effect");
    }
    const viewport = ports.viewport(context);
    if (!viewport) {
      return fail(group, "viewport");
    }
    frame!.commands.push({ camera, kind: "viewport-clip", rect: { ...viewport } }, command);
    return undefined;
  };
  const tint = (group: Group, values: readonly number[]) => {
    if (!uniform(values)) {
      fail(group, "effect");
    }
    return packed(values[0]!);
  };
  const mode = (group: Group, value: number): "multiply" | "fill" => {
    if (value !== 0 && value !== 1) {
      fail(group, "effect");
    }
    return value === 1 ? "fill" : "multiply";
  };
  const capture = (group: Group, object: ObjectView, method: "run" | "batch", args: unknown[]) => {
    const context = args[0] as Context;
    if (object.type === "BitmapText") {
      if (method !== "run") {
        fail(group, "object-kind");
      }
      const text = object as unknown as GameObjects.BitmapText;
      const texture = args[4] as { uvSource: GameObjects.BitmapText["fontData"]["chars"][number] };
      const transform = args[5] as { quad: Float32Array };
      const colours = args[6] as Record<string, number>;
      const glyph = texture.uvSource;
      const code = Object.entries(text.fontData.chars).find(([, value]) => value === glyph)?.[0];
      const style = ports.textStyle(text);
      if (code === undefined || !style || style.size !== text.fontData.size) {
        fail(group, "font");
      }
      const pen = uiGlyphPen(
        { baseline: style!.baseline },
        { glyph, quad: quad(transform.quad), text: String.fromCodePoint(Number(code)) },
      );
      if (!pen) {
        return;
      }
      const [r, g, b, alpha] = tint(group, [
        colours.tintTopLeft!,
        colours.tintTopRight!,
        colours.tintBottomLeft!,
        colours.tintBottomRight!,
      ]);
      append(group, context, {
        alpha,
        face: { ...style!.face },
        glyphs: [pen],
        kind: "text",
        owner: group.owner,
        size: style!.size,
        tint: [r, g, b],
        tintMode: mode(group, colours.tintEffect!),
      });
    } else if (object.type === "Rectangle" || object.type === "Graphics") {
      if (method !== "batch" || args[4]) {
        fail(group, "effect");
      }
      const indices = args[1] as number[];
      const positions = args[2] as number[];
      const colours = args[3] as number[];
      const colour = tint(
        group,
        indices.map((index) => colours[index]!),
      );
      append(group, context, {
        kind: "triangles",
        owner: group.owner,
        vertices: indices.map((index) => ({
          at: { x: positions[index * 2]!, y: positions[index * 2 + 1]! },
          colour: [...colour] as Colour,
        })),
      });
    } else {
      if (method !== "batch") {
        fail(group, "object-kind");
      }
      const sourceFrame = object.frame!;
      const raster = ports.image(sourceFrame);
      if (!raster) {
        fail(group, "raster");
      }
      const [r, g, b, alpha] = tint(group, args.slice(15, 19) as number[]);
      const uv = args.slice(10, 14) as number[];
      const uw = sourceFrame.u1 - sourceFrame.u0;
      const vh = sourceFrame.v1 - sourceFrame.v0;
      const source: UiRaster = {
        image: raster!.image,
        source: {
          height: (raster!.source.height * uv[3]!) / vh,
          width: (raster!.source.width * uv[2]!) / uw,
          x: raster!.source.x + ((uv[0]! - sourceFrame.u0) / uw) * raster!.source.width,
          y: raster!.source.y + ((uv[1]! - sourceFrame.v0) / vh) * raster!.source.height,
        },
      };
      const points = args.slice(2, 10) as number[]; // Batch order TL, BL, TR, BR.
      append(group, context, {
        alpha,
        kind: "quad",
        owner: group.owner,
        quad: quad([...points.slice(0, 4), ...points.slice(6, 8), ...points.slice(4, 6)]),
        raster: source,
        sampling: sourceFrame.source.scaleMode === 0 ? "linear" : "nearest",
        tint: [r, g, b],
        tintMode: mode(group, args[14] as number),
      });
    }
  };
  const refresh = (group: Group, roots: readonly GameObjects.GameObject[]): UiRefreshResult => {
    if (disposed || group.dead) {
      restore(group);
      return { issues: [{ owner: group.owner, reason: "renderer" }], status: "unsupported" };
    }
    if (fontState !== "ready") {
      restore(group);
      return {
        reason: fontState === "pending" ? "fonts-pending" : "font-failed",
        status: "not-ready",
      };
    }
    const leaves: ObjectView[] = [];
    const seen = new Set<GameObjects.GameObject>();
    const issues: UiIssue[] = [];
    const visit = (object: ObjectView) => {
      const issue = (reason: UiIssue["reason"]) => issues.push({ owner: group.owner, reason });
      if (
        seen.has(object) ||
        [...groups].some((other) => other !== group && other.members.has(object))
      ) {
        issue("object-kind");
        return;
      }
      seen.add(object);
      const owned = group.saved.find((saved) => saved.object === object);
      if (owned && object.customRenderNodes?.[owned.role] !== owned.node) {
        issue("renderer");
      }
      if (!kinds.has(object.type)) {
        issue("object-kind");
      }
      if (object.mask) {
        issue("mask");
      }
      if (
        object.filters &&
        (object.filters.internal.getActive().length || object.filters.external.getActive().length)
      ) {
        issue("effect");
      }
      if (
        object.blendMode !== undefined &&
        object.blendMode !== 0 &&
        !(object.type === "Container" && object.blendMode === -1)
      ) {
        issue("blend");
      }
      if (
        !uniform([
          object.tintTopLeft,
          object.tintTopRight,
          object.tintBottomLeft,
          object.tintBottomRight,
        ]) ||
        !uniform([
          object.alphaTopLeft,
          object.alphaTopRight,
          object.alphaBottomLeft,
          object.alphaBottomRight,
        ]) ||
        (object.tintMode !== undefined && object.tintMode !== 0 && object.tintMode !== 1) ||
        object.lighting ||
        object.dropShadowX ||
        object.dropShadowY
      ) {
        issue("effect");
      }
      if (object.type === "Container") {
        for (const child of object.list ?? []) {
          visit(child as ObjectView);
        }
      } else {
        if (!object.setRenderNodeRole || !renderManager(object)) {
          issue("renderer");
        }
        if (object.type === "Graphics" && !graphicsSupported(object.commandBuffer ?? [])) {
          issue("effect");
        }
        if (object.type === "BitmapText") {
          const text = object as unknown as GameObjects.BitmapText;
          const style = ports.textStyle(text);
          if (!style || style.size !== text.fontData.size) {
            issue("font");
          }
          for (const colour of Object.values(object.charColors ?? {})) {
            if (
              colour &&
              (!uniform([colour.tintTL, colour.tintTR, colour.tintBL, colour.tintBR]) ||
                (colour.tintEffect !== 0 && colour.tintEffect !== 1))
            ) {
              issue("effect");
            }
          }
        }
        if (
          ["NineSlice", "Image", "Sprite"].includes(object.type) &&
          (!object.frame || !ports.image(object.frame))
        ) {
          issue("raster");
        }
        leaves.push(object);
      }
    };
    for (const root of roots) {
      visit(root as ObjectView);
    }
    if (issues.length) {
      restore(group);
      return { issues, status: "unsupported" };
    }
    restore(group);
    try {
      for (const object of leaves) {
        const role = ["Image", "Sprite", "NineSlice"].includes(object.type)
          ? "BatchHandler"
          : "Submitter";
        const previous = object.customRenderNodes?.[role];
        const data = previous
          ? (object.renderNodeData?.[previous.name] as object | undefined)
          : undefined;
        const node = new CaptureNode(renderManager(object)!, (method, args) =>
          capture(group, object, method, args),
        );
        group.saved.push({ data, node, object, previous, role });
        object.setRenderNodeRole!(role, node);
        if (object.customRenderNodes?.[role] !== node) {
          fail(group, "renderer");
        }
      }
    } catch {
      restore(group);
      return { issues: [{ owner: group.owner, reason: "renderer" }], status: "unsupported" };
    }
    group.members = seen;
    group.roots = [...roots];
    return { status: "ready" };
  };
  return {
    begin(frameId, projection) {
      if (disposed || frame) {
        throw new Error("UI recorder is disposed or a frame is already open");
      }
      frame = { commands: [], id: frameId, projection };
    },
    destroy() {
      disposed = true;
      for (const group of groups) {
        group.dead = true;
        restore(group);
      }
      groups.clear();
      frame = undefined;
    },
    finish() {
      if (!frame || disposed) {
        throw new Error("UI recorder has no live frame");
      }
      const result = frame;
      frame = undefined;
      return result;
    },
    register(roots) {
      const group: Group = { dead: false, members: new Set(), owner: {}, roots: [], saved: [] };
      const result = refresh(group, roots);
      if (result.status !== "ready") {
        return result;
      }
      groups.add(group);
      const handle: UiRootHandle = {
        destroy() {
          if (!group.dead) {
            group.dead = true;
            restore(group);
            groups.delete(group);
          }
        },
        get owner() {
          return group.owner;
        },
        refresh: (next = group.roots) => refresh(group, next),
        get roots() {
          return group.roots;
        },
      };
      return { handle, status: "ready" };
    },
  };
}
