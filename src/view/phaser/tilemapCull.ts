import { type Cameras, Math as PhaserMath, Tilemaps } from "phaser";

// The camera members the cull reads.
export type CullCamera = Pick<
  Cameras.Scene2D.Camera,
  "height" | "originX" | "originY" | "scrollX" | "scrollY" | "width" | "zoomX" | "zoomY"
>;

// Tile columns from left to right and rows from top to bottom; right and bottom are exclusive.
export interface TileBounds {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

// The columns and rows of data's orthogonal layer inside the area camera shows, padded by the
// layer's cullPaddingX columns and cullPaddingY rows. The camera draws world x at screen
// o + zoomX * (x - scrollX - o), with o = width * originX, so it shows scrollX + o - o / zoomX
// across width / zoomX, and likewise down. Tiles are the map's tile size times the layer's
// scale, floored, as in Phaser's own cull, which this equals for origin 0.5.
export function cameraTileBounds(camera: CullCamera, data: Tilemaps.LayerData): TileBounds {
  const layer = data.tilemapLayer;
  const tileWidth = Math.floor(layer.tilemap.tileWidth * layer.scaleX);
  const tileHeight = Math.floor(layer.tilemap.tileHeight * layer.scaleY);
  const originX = camera.width * camera.originX;
  const originY = camera.height * camera.originY;
  const viewWidth = camera.width / camera.zoomX;
  const viewHeight = camera.height / camera.zoomY;
  const viewX = camera.scrollX + originX - originX / camera.zoomX;
  const viewY = camera.scrollY + originY - originY / camera.zoomY;
  const { Ceil, Floor } = PhaserMath.Snap;
  return {
    bottom: Ceil(viewY + viewHeight - layer.y, tileHeight, 0, true) + layer.cullPaddingY,
    left: Floor(viewX - layer.x, tileWidth, 0, true) - layer.cullPaddingX,
    right: Ceil(viewX + viewWidth - layer.x, tileWidth, 0, true) + layer.cullPaddingX,
    top: Floor(viewY - layer.y, tileHeight, 0, true) - layer.cullPaddingY,
  };
}

// Replaces layer's cull with one over cameraTileBounds. As Phaser's own cull, it keeps every tile
// of a layer with skipCull or a scroll factor other than 1. Throws on a layer that is not
// orthogonal.
// WORKAROUND: Phaser 4.2.1 culls a tilemap layer to camera.worldView, which Camera#preRender
// places as if the camera zooms about its centre whatever its origin, so a camera with another
// origin at a zoom other than 1 leaves out a band of the tiles it shows. Remove once worldView
// follows the camera's origin.
// https://github.com/phaserjs/phaser/blob/v4.2.1/src/cameras/2d/Camera.js#L599-L612
// https://github.com/phaserjs/phaser/blob/v4.2.1/src/tilemaps/components/CullBounds.js#L38-L42
export function cullToCameraView(layer: Tilemaps.TilemapLayer): void {
  if (layer.layer.orientation !== Tilemaps.Orientation.ORTHOGONAL) {
    throw new Error(`Layer ${layer.layer.name} is not orthogonal`);
  }
  layer.cullCallback = (
    data: Tilemaps.LayerData,
    camera: CullCamera,
    output: Tilemaps.Tile[],
    renderOrder: number,
  ): Tilemaps.Tile[] => {
    output.length = 0;
    const { scrollFactorX, scrollFactorY, skipCull } = data.tilemapLayer;
    const bounds =
      skipCull || scrollFactorX !== 1 || scrollFactorY !== 1
        ? { bottom: data.height, left: 0, right: data.width, top: 0 }
        : cameraTileBounds(camera, data);
    return Tilemaps.Components.RunCull(data, bounds, renderOrder, output);
  };
}
