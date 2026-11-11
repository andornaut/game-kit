import type { Rect } from "../../../rect.ts";

// Sheet frames as CSS images. A packed sheet holds many frames, and CSS border-image and
// background-image take a whole image, so each frame is cut out of the image source the game has
// already loaded into its own blob: image (which a CSP img-src of 'self' blob: allows), with no
// second download. ui.css .ui-frame draws a nine-slice frame from the custom properties set here.

// A nine-slice frame's insets, in the frame's own pixels.
export interface SliceInsets {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

// Cuts rect, in source pixels, out of source into its own PNG and returns its blob: URL, which the
// caller revokes with URL.revokeObjectURL once nothing shows it. Rejects where the page has no 2D
// canvas or cannot encode it.
export async function cutFrame(
  document: Document,
  source: CanvasImageSource,
  rect: Rect,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("No 2D canvas to cut a sheet frame with");
  }
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (blob === null) {
    throw new Error("Unable to encode a sheet frame");
  }
  return URL.createObjectURL(blob);
}

// Sets a cut frame on element as --<name>-image (its url()) and --<name>-slice (its insets, as
// border-image-slice numbers), for .ui-frame's --ui-frame-image and --ui-frame-slice to read.
export function setNineSlice(
  name: string,
  frame: { readonly slice: SliceInsets; readonly url: string },
  element: ElementCSSInlineStyle,
): void {
  const { bottom, left, right, top } = frame.slice;
  element.style.setProperty(`--${name}-image`, `url("${frame.url}")`);
  element.style.setProperty(`--${name}-slice`, `${top} ${right} ${bottom} ${left}`);
}
