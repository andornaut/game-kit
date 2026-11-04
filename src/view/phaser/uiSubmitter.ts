import {
  BlendModes,
  type GameObjects,
  Renderer,
  ScaleModes,
  type Scene,
  type Textures,
  TintModes,
} from "phaser";

import { uiGlyphPen } from "../../text/phaser/uiGlyphPen.ts";
import type {
  Colour,
  Owner,
  Quad,
  Rgb,
  UiCapturePorts,
  UiFontFace,
  UiFrame,
  UiGlyphPen,
  UiIssue,
  UiPaintCommand,
  UiProjection,
  UiRaster,
  UiRefreshResult,
  UiRegistration,
  UiRootHandle,
  UiTextCommand,
  Vertex,
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
  const renderer = object.scene?.sys.renderer;
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
function sameFace(a: UiFontFace, b: UiFontFace): boolean {
  return a.family === b.family && a.role === b.role && a.style === b.style && a.weight === b.weight;
}
function tintModeSupported(value: number): boolean {
  return value === TintModes.MULTIPLY || value === TintModes.FILL;
}
function uniform(values: readonly unknown[]): boolean {
  return values.every((value) => value === values[0]);
}
function packedRgb(value: number): Rgb {
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}
function packedAlpha(value: number): number {
  return (value >>> 24) / 255;
}
function quad(values: ArrayLike<number>): Quad {
  return [
    { x: values[0]!, y: values[1]! },
    { x: values[2]!, y: values[3]! },
    { x: values[4]!, y: values[5]! },
    { x: values[6]!, y: values[7]! },
  ];
}
type Glyph = GameObjects.BitmapText["fontData"]["chars"][number];
type Chars = GameObjects.BitmapText["fontData"]["chars"];
// BatchChar passes only the glyph object; codes are indexed once per font.
const glyphCodes = new WeakMap<Chars, Map<Glyph, number>>();
function indexGlyphs(chars: Chars): Map<Glyph, number> {
  const codes = new Map<Glyph, number>();
  for (const [code, glyph] of Object.entries(chars)) {
    if (!codes.has(glyph)) {
      codes.set(glyph, Number(code));
    }
  }
  glyphCodes.set(chars, codes);
  return codes;
}
function glyphCode(chars: Chars, glyph: Glyph): number | undefined {
  // A miss reindexes once, so glyphs added to the font after indexing still resolve.
  return glyphCodes.get(chars)?.get(glyph) ?? indexGlyphs(chars).get(glyph);
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
  let clip: Extract<UiPaintCommand, { kind: "viewport-clip" }> | undefined;
  let run: { object: ObjectView; command: UiTextCommand; glyphs: UiGlyphPen[] } | undefined;
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
        if (!saved.object.scene || saved.object.isDestroyed) {
          delete saved.object.customRenderNodes[saved.role];
          if (saved.object.renderNodeData) {
            delete saved.object.renderNodeData[saved.node.name];
          }
          continue;
        }
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
  // Emits a viewport clip only when the camera or its rect differs from the last one emitted.
  // Clips survive group restoration, so the last emitted clip stays current.
  const clipTo = (group: Group, context: Context): boolean => {
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
    if (
      clip &&
      clip.camera === camera &&
      clip.rect.x === viewport.x &&
      clip.rect.y === viewport.y &&
      clip.rect.width === viewport.width &&
      clip.rect.height === viewport.height
    ) {
      return false;
    }
    clip = { camera, kind: "viewport-clip", rect: { ...viewport } };
    frame!.commands.push(clip);
    return true;
  };
  const append = (group: Group, context: Context, command: UiPaintCommand) => {
    clipTo(group, context);
    frame!.commands.push(command);
  };
  // Consecutive glyphs of one object with one style, tint and alpha share a text command.
  const appendGlyph = (
    group: Group,
    context: Context,
    object: ObjectView,
    command: Omit<UiTextCommand, "glyphs">,
    pen: UiGlyphPen,
  ) => {
    const clipped = clipTo(group, context);
    const commands = frame!.commands;
    const last = run?.object === object ? run.command : undefined;
    if (
      !clipped &&
      last !== undefined &&
      last === commands[commands.length - 1] &&
      last.alpha === command.alpha &&
      last.size === command.size &&
      last.tintMode === command.tintMode &&
      last.tint.every((component, i) => component === command.tint[i]) &&
      sameFace(last.face, command.face)
    ) {
      run!.glyphs.push(pen);
      return;
    }
    const glyphs = [pen];
    run = { command: { ...command, glyphs }, glyphs, object };
    commands.push(run.command);
  };
  // Returns the packed colour shared by all four corners.
  const tint = (group: Group, a: number, b: number, c: number, d: number): number => {
    if (a !== b || a !== c || a !== d) {
      fail(group, "effect");
    }
    return a;
  };
  const mode = (group: Group, value: number): "multiply" | "fill" => {
    if (!tintModeSupported(value)) {
      fail(group, "effect");
    }
    return value === TintModes.FILL ? "fill" : "multiply";
  };
  const capture = (group: Group, object: ObjectView, method: "run" | "batch", args: unknown[]) => {
    const context = args[0] as Context;
    if (object.type === "BitmapText") {
      if (method !== "run") {
        fail(group, "object-kind");
      }
      const text = object as unknown as GameObjects.BitmapText;
      const texture = args[4] as { uvSource: Glyph };
      const transform = args[5] as { quad: Float32Array };
      const colours = args[6] as Record<string, number>;
      const glyph = texture.uvSource;
      const code = glyphCode(text.fontData.chars, glyph);
      const style = ports.textStyle(text);
      if (code === undefined || !style || style.size !== text.fontData.size) {
        fail(group, "font");
      }
      const pen = uiGlyphPen(
        { baseline: style!.baseline },
        { glyph, quad: quad(transform.quad), text: String.fromCodePoint(code!) },
      );
      if (!pen) {
        return;
      }
      const value = tint(
        group,
        colours.tintTopLeft!,
        colours.tintTopRight!,
        colours.tintBottomLeft!,
        colours.tintBottomRight!,
      );
      appendGlyph(
        group,
        context,
        object,
        {
          alpha: packedAlpha(value),
          face: { ...style!.face },
          kind: "text",
          owner: group.owner,
          size: style!.size,
          tint: packedRgb(value),
          tintMode: mode(group, colours.tintEffect!),
        },
        pen,
      );
    } else if (object.type === "Rectangle" || object.type === "Graphics") {
      if (method !== "batch" || args[4]) {
        fail(group, "effect");
      }
      const indices = args[1] as readonly number[];
      const positions = args[2] as readonly number[];
      const colours = args[3] as readonly number[];
      const value = colours[indices[0]!]!;
      for (const index of indices) {
        if (colours[index] !== value) {
          fail(group, "effect");
        }
      }
      // One frozen tuple per command; every vertex shares it.
      const colour: Colour = Object.freeze([...packedRgb(value), packedAlpha(value)] as const);
      const vertices: Vertex[] = [];
      for (const index of indices) {
        vertices.push({ at: { x: positions[index * 2]!, y: positions[index * 2 + 1]! }, colour });
      }
      append(group, context, { kind: "triangles", owner: group.owner, vertices });
    } else {
      if (method !== "batch") {
        fail(group, "object-kind");
      }
      const sourceFrame = object.frame!;
      const raster = ports.image(sourceFrame);
      if (!raster) {
        fail(group, "raster");
      }
      // BatchHandlerQuad.batch(context, texture, x0..y3, texX, texY, texWidth, texHeight,
      // tintMode, tintTL, tintBL, tintTR, tintBR, ...). Corners arrive TL, BL, TR, BR.
      const value = tint(
        group,
        args[15] as number,
        args[16] as number,
        args[17] as number,
        args[18] as number,
      );
      const uw = sourceFrame.u1 - sourceFrame.u0;
      const vh = sourceFrame.v1 - sourceFrame.v0;
      const { source: frameRect } = raster!;
      const source: UiRaster = {
        image: raster!.image,
        source: {
          height: (frameRect.height * (args[13] as number)) / vh,
          width: (frameRect.width * (args[12] as number)) / uw,
          x: frameRect.x + (((args[10] as number) - sourceFrame.u0) / uw) * frameRect.width,
          y: frameRect.y + (((args[11] as number) - sourceFrame.v0) / vh) * frameRect.height,
        },
      };
      append(group, context, {
        alpha: packedAlpha(value),
        kind: "quad",
        owner: group.owner,
        quad: [
          { x: args[2] as number, y: args[3] as number },
          { x: args[4] as number, y: args[5] as number },
          { x: args[8] as number, y: args[9] as number },
          { x: args[6] as number, y: args[7] as number },
        ],
        raster: source,
        sampling: sourceFrame.source.scaleMode === ScaleModes.LINEAR ? "linear" : "nearest",
        tint: packedRgb(value),
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
        object.blendMode !== BlendModes.NORMAL &&
        !(object.type === "Container" && object.blendMode === BlendModes.SKIP_CHECK)
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
        (object.tintMode !== undefined && !tintModeSupported(object.tintMode)) ||
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
                !tintModeSupported(colour.tintEffect))
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
      clip = undefined;
      run = undefined;
    },
    destroy() {
      disposed = true;
      for (const group of groups) {
        group.dead = true;
        restore(group);
      }
      groups.clear();
      frame = undefined;
      clip = undefined;
      run = undefined;
    },
    finish() {
      if (!frame || disposed) {
        throw new Error("UI recorder has no live frame");
      }
      const result = frame;
      frame = undefined;
      clip = undefined;
      run = undefined;
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
