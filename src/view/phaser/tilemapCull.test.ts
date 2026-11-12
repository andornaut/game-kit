import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { type Cameras, type GameObjects, type Geom, Tilemaps } from "phaser";
import { describe, expect, it, vi } from "vitest";

import { cameraTileBounds, cullToCameraView, type TileBounds } from "./tilemapCull.ts";

vi.mock("phaser", async () => {
  const nodeModule = await import("node:module");
  const path = await import("node:path");
  const load = nodeModule.createRequire(import.meta.url);
  const root = path.dirname(load.resolve("phaser/package.json"));
  const source = (file: string) => load(path.join(root, "src", file));
  // The real snapping, cull loop and orientations, so the cull is checked against Phaser's own.
  return {
    Math: {
      Snap: { Ceil: source("math/snap/SnapCeil.js"), Floor: source("math/snap/SnapFloor.js") },
    },
    Tilemaps: {
      Components: { RunCull: source("tilemaps/components/RunCull.js") },
      Orientation: source("tilemaps/const/ORIENTATION_CONST.js"),
    },
  };
});

// Phaser's own matrix, rectangle and cull bounds. Phaser's Camera loads the device checks, which
// need a browser, so camera() below sets what its preRender sets instead.
const phaserRequire = createRequire(import.meta.url);
const phaserRoot = dirname(phaserRequire.resolve("phaser/package.json"));
const phaserSource = (file: string) => phaserRequire(join(phaserRoot, "src", file));
type Camera2D = Cameras.Scene2D.Camera;
type Matrix = GameObjects.Components.TransformMatrix;
type ViewCamera = Camera2D & { readonly matrix: Matrix };
const matrixFile = "gameobjects/components/TransformMatrix.js";
const TransformMatrix = phaserSource(matrixFile) as new () => Matrix;
const Rectangle = phaserSource("geom/rectangle/Rectangle.js") as typeof Geom.Rectangle;
type CullBounds = typeof Tilemaps.Components.CullBounds;
const phaserCullBounds = phaserSource("tilemaps/components/CullBounds.js") as CullBounds;

const TILE = 16;
const SCROLL = { x: 1000.4, y: 37.3 };

interface View {
  height: number;
  originX: number;
  originY: number;
  width: number;
  zoom: number;
}

// A camera at the screen's top-left showing view, scrolled to SCROLL, as Camera#preRender leaves
// it: worldView placed about the centre (Camera.js lines 599 to 612), and the matrix the renderer
// draws with, which zooms about the origin (lines 537 to 538 and 630 to 631).
function camera(view: View): ViewCamera {
  const { height, originX, originY, width, zoom } = view;
  const displayWidth = width / zoom;
  const displayHeight = height / zoom;
  const worldView = new Rectangle(
    SCROLL.x + width * 0.5 - displayWidth / 2,
    SCROLL.y + height * 0.5 - displayHeight / 2,
    displayWidth,
    displayHeight,
  );
  const matrix = new TransformMatrix()
    .applyITRS(width * originX, height * originY, 0, zoom, zoom)
    .translate(-SCROLL.x - width * originX, -SCROLL.y - height * originY);
  return {
    height,
    matrix,
    originX,
    originY,
    scrollX: SCROLL.x,
    scrollY: SCROLL.y,
    width,
    worldView,
    zoomX: zoom,
    zoomY: zoom,
  } as unknown as ViewCamera;
}

interface LayerOptions {
  cullPaddingX?: number;
  cullPaddingY?: number;
  orientation?: number;
  scale?: number;
  scrollFactor?: number;
  skipCull?: boolean;
  x?: number;
  y?: number;
}

const COLUMNS = 200;
const ROWS = 40;

// A layer of COLUMNS by ROWS visible tiles, each tile its own { x, y }, and its LayerData.
function tilemapLayer(options: LayerOptions = {}) {
  const scale = options.scale ?? 1;
  const data = {
    data: Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLUMNS }, (_, x) => ({ alpha: 1, index: 1, visible: true, x, y })),
    ),
    height: ROWS,
    name: "terrain",
    orientation: options.orientation ?? Tilemaps.Orientation.ORTHOGONAL,
    tilemapLayer: {},
    width: COLUMNS,
  };
  const layer = {
    cullCallback: undefined as unknown,
    cullPaddingX: options.cullPaddingX ?? 0,
    cullPaddingY: options.cullPaddingY ?? 0,
    layer: data,
    scaleX: scale,
    scaleY: scale,
    scrollFactorX: options.scrollFactor ?? 1,
    scrollFactorY: options.scrollFactor ?? 1,
    skipCull: options.skipCull ?? false,
    tilemap: { tileHeight: TILE, tileWidth: TILE },
    x: options.x ?? 0,
    y: options.y ?? 0,
  };
  data.tilemapLayer = layer;
  return {
    data: data as unknown as Tilemaps.LayerData,
    layer: layer as unknown as Tilemaps.TilemapLayer,
  };
}

// The tiles of the world area the camera's matrix maps onto its viewport, padded as the layer is.
function shownBounds(view: ViewCamera, data: Tilemaps.LayerData): TileBounds {
  const layer = data.tilemapLayer;
  const tileWidth = Math.floor(TILE * layer.scaleX);
  const tileHeight = Math.floor(TILE * layer.scaleY);
  const topLeft = view.matrix.applyInverse(0, 0);
  const bottomRight = view.matrix.applyInverse(view.width, view.height);
  return {
    bottom: Math.ceil((bottomRight.y - layer.y) / tileHeight) + layer.cullPaddingY,
    left: Math.floor((topLeft.x - layer.x) / tileWidth) - layer.cullPaddingX,
    right: Math.ceil((bottomRight.x - layer.x) / tileWidth) + layer.cullPaddingX,
    top: Math.floor((topLeft.y - layer.y) / tileHeight) - layer.cullPaddingY,
  };
}

function phaserBounds(view: Camera2D, data: Tilemaps.LayerData): TileBounds {
  const { bottom, left, right, top } = phaserCullBounds(data, view);
  return { bottom, left, right, top };
}

const PHONE = { height: 450, width: 800 };

describe("cameraTileBounds", () => {
  it("keeps the left and top band a top-left-origin camera shows at a zoom above 1", () => {
    const view = camera({ ...PHONE, originX: 0, originY: 0, zoom: 2.5 });
    const { data } = tilemapLayer();
    const bounds = cameraTileBounds(view, data);
    expect(bounds).toEqual(shownBounds(view, data));
    expect(bounds).toEqual({ bottom: 14, left: 62, right: 83, top: 2 });
    // Phaser's own cull starts 15 columns and 8 rows further in.
    expect(phaserBounds(view, data)).toMatchObject({ left: 77, top: 10 });
  });

  it("keeps the right and bottom band a top-left-origin camera shows at a zoom below 1", () => {
    const view = camera({ ...PHONE, originX: 0, originY: 0, zoom: 0.5 });
    const { data } = tilemapLayer();
    const bounds = cameraTileBounds(view, data);
    expect(bounds).toEqual(shownBounds(view, data));
    expect(phaserBounds(view, data).right).toBeLessThan(bounds.right);
    expect(phaserBounds(view, data).bottom).toBeLessThan(bounds.bottom);
  });

  it.each([
    ["at zoom 1", 1],
    ["at a fractional zoom above 1", 2.37],
    ["at a fractional zoom below 1", 0.61],
  ])("equals Phaser's own cull for a centred camera %s", (_, zoom) => {
    const view = camera({ ...PHONE, originX: 0.5, originY: 0.5, zoom });
    const { data } = tilemapLayer({
      cullPaddingX: 1,
      cullPaddingY: 2,
      scale: 1.3,
      x: 33.5,
      y: -12,
    });
    expect(cameraTileBounds(view, data)).toEqual(phaserBounds(view, data));
    expect(cameraTileBounds(view, data)).toEqual(shownBounds(view, data));
  });

  it("follows an origin other than the corners and the centre", () => {
    const view = camera({ ...PHONE, originX: 0.25, originY: 0.75, zoom: 1.7 });
    const { data } = tilemapLayer();
    expect(cameraTileBounds(view, data)).toEqual(shownBounds(view, data));
    expect(cameraTileBounds(view, data)).not.toEqual(phaserBounds(view, data));
  });

  it("pads by the layer's cullPaddingX columns and cullPaddingY rows", () => {
    const view = camera({ ...PHONE, originX: 0, originY: 0, zoom: 2.5 });
    const padded = cameraTileBounds(view, tilemapLayer({ cullPaddingX: 2, cullPaddingY: 3 }).data);
    expect(padded).toEqual({ bottom: 17, left: 60, right: 85, top: -1 });
  });

  it("measures from the layer's position", () => {
    const view = camera({ ...PHONE, originX: 0, originY: 0, zoom: 2.5 });
    const { data } = tilemapLayer({ x: 200.5, y: -40 });
    expect(cameraTileBounds(view, data)).toEqual(shownBounds(view, data));
    // 1000.4 - 200.5 is column 49; 37.3 + 40 is row 4.
    expect(cameraTileBounds(view, data)).toMatchObject({ left: 49, top: 4 });
  });

  it("sizes tiles by the map's tile size times the layer's scale, floored", () => {
    const view = camera({ ...PHONE, originX: 0, originY: 0, zoom: 2.5 });
    // 16 * 1.3 floors to 20: column 50 (1000.4 / 20) and row 1 (37.3 / 20).
    const { data } = tilemapLayer({ scale: 1.3 });
    expect(cameraTileBounds(view, data)).toEqual(shownBounds(view, data));
    expect(cameraTileBounds(view, data)).toMatchObject({ left: 50, top: 1 });
  });
});

type Cull = (
  data: Tilemaps.LayerData,
  camera: Camera2D,
  output: Tilemaps.Tile[],
  renderOrder: number,
) => Tilemaps.Tile[];

// The columns and rows of the tiles a cull returned.
function spans(tiles: readonly Tilemaps.Tile[]): TileBounds {
  const xs = tiles.map((tile) => tile.x);
  const ys = tiles.map((tile) => tile.y);
  return {
    bottom: Math.max(...ys) + 1,
    left: Math.min(...xs),
    right: Math.max(...xs) + 1,
    top: Math.min(...ys),
  };
}

describe("cullToCameraView", () => {
  const VIEW = { ...PHONE, originX: 0, originY: 0, zoom: 2.5 };

  it("culls into the layer's output to the tiles the camera shows", () => {
    const { data, layer } = tilemapLayer({ cullPaddingX: 1, cullPaddingY: 1 });
    cullToCameraView(layer);
    const output = [{} as Tilemaps.Tile];
    const view = camera(VIEW);
    const tiles = (layer.cullCallback as Cull)(data, view, output, 0);
    expect(tiles).toBe(output);
    expect(spans(tiles)).toEqual(cameraTileBounds(view, data));
    expect(tiles).toHaveLength((83 + 1 - (62 - 1)) * (14 + 1 - (2 - 1)));
  });

  it("passes the render order to the cull", () => {
    const { data, layer } = tilemapLayer();
    cullToCameraView(layer);
    const view = camera(VIEW);
    // Order 0 is right-down, from the top-left tile; order 3 is left-up, from the bottom-right.
    const rightDown = (layer.cullCallback as Cull)(data, view, [], 0);
    const leftUp = (layer.cullCallback as Cull)(data, view, [], 3);
    const shown = spans(rightDown);
    expect(rightDown[0]).toMatchObject({ x: shown.left, y: shown.top });
    expect(leftUp[0]).toMatchObject({ x: spans(leftUp).right - 1, y: spans(leftUp).bottom - 1 });
  });

  it.each([
    ["skipCull", { skipCull: true }],
    ["a scroll factor other than 1", { scrollFactor: 0.5 }],
  ])("keeps every tile of a layer with %s, as Phaser's own cull", (_, options) => {
    const { data, layer } = tilemapLayer(options);
    cullToCameraView(layer);
    const tiles = (layer.cullCallback as Cull)(data, camera(VIEW), [], 0);
    expect(tiles).toHaveLength(COLUMNS * ROWS);
  });

  it("throws on a layer that is not orthogonal, leaving its cull", () => {
    const { layer } = tilemapLayer({ orientation: Tilemaps.Orientation.ISOMETRIC });
    expect(() => cullToCameraView(layer)).toThrow("Layer terrain is not orthogonal");
    expect(layer.cullCallback).toBeUndefined();
  });
});
