// An image's pixels, 4 bytes each (red, green, blue, alpha), row by row from the top-left.
export interface RgbaImage {
  data: Uint8Array;
  height: number;
  width: number;
}
