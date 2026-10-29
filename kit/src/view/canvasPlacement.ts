// Where the canvas sits in the space its page gives it, always centred across. centre: centred
// up and down too, the letterbox split above and below. topInPortrait: at the top of a portrait
// viewport (taller than wide), so all the spare height sits under the game, and centred up and
// down in landscape.
export type CanvasPlacement = "centre" | "topInPortrait";

// Whether the canvas is centred up and down in a viewport of this size, rather than at its
// space's top.
export function centresVertically(
  placement: CanvasPlacement,
  viewport: { readonly height: number; readonly width: number },
): boolean {
  return placement === "centre" || viewport.height <= viewport.width;
}
