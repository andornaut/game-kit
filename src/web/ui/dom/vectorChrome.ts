import { assertNever } from "../../../assertNever.ts";
import type { Point, Rect } from "../../../rect.ts";

// Vector control chrome (rings, discs, paths and bars, such as a pause disc, skill circles, touch
// control rings and their help illustrations) as inline SVG, sharp at any device pixel ratio with
// nothing repainted on resize. The game supplies the layers, in its frame's base pixels, and their
// colours; CSS sizes the element.

export type ChromeLayer =
  | {
      readonly centre: Point;
      readonly colour: number;
      readonly kind: "disc";
      readonly radius: number;
    }
  | {
      readonly centre: Point;
      readonly colour: number;
      readonly inner: number;
      readonly kind: "ring";
      readonly outer: number;
    }
  | {
      readonly colour: number;
      readonly kind: "stroke";
      readonly path: readonly Point[];
      readonly width: number;
    }
  | { readonly colour: number; readonly kind: "rect"; readonly rect: Rect };

const SVG = "http://www.w3.org/2000/svg";

// A 0xrrggbb colour as #rrggbb.
function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

function shape(document: Document, layer: ChromeLayer): SVGElement {
  const element = (tag: string, attributes: Record<string, number | string>) => {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, String(value));
    }
    return node;
  };
  const colour = hex(layer.colour);
  switch (layer.kind) {
    case "disc":
      return element("circle", {
        cx: layer.centre.x,
        cy: layer.centre.y,
        fill: colour,
        r: layer.radius,
      });
    case "ring":
      return element("circle", {
        cx: layer.centre.x,
        cy: layer.centre.y,
        fill: "none",
        r: (layer.outer + layer.inner) / 2,
        stroke: colour,
        "stroke-width": layer.outer - layer.inner,
      });
    case "stroke":
      return element("path", {
        d: layer.path.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" "),
        fill: "none",
        stroke: colour,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-width": layer.width,
      });
    case "rect":
      return element("rect", {
        fill: colour,
        height: layer.rect.height,
        width: layer.rect.width,
        x: layer.rect.x,
        y: layer.rect.y,
      });
    default:
      return assertNever(layer);
  }
}

// An aria-hidden SVG of frame's size in base pixels with layers painted in order, the later over
// the earlier.
export function createChromeSvg(
  document: Document,
  frame: { readonly height: number; readonly width: number },
  layers: readonly ChromeLayer[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.append(...layers.map((layer) => shape(document, layer)));
  return svg;
}
