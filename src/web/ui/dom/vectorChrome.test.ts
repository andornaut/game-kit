// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { type ChromeLayer, createChromeSvg } from "./vectorChrome.ts";

const LAYERS: readonly ChromeLayer[] = [
  { centre: { x: 17.5, y: 17.5 }, colour: 0x181425, kind: "disc", radius: 16.5 },
  { centre: { x: 37.5, y: 37.5 }, colour: 0xead4aa, inner: 32.5, kind: "ring", outer: 35.5 },
  {
    colour: 0x0000ff,
    kind: "stroke",
    path: [
      { x: 18, y: 34 },
      { x: 13, y: 37.5 },
    ],
    width: 4,
  },
  { colour: 0xffffff, kind: "rect", rect: { height: 13, width: 4, x: 12, y: 11 } },
];

const attributes = (element: Element, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));

describe("createChromeSvg", () => {
  const svg = createChromeSvg(document, { height: 35, width: 75 }, LAYERS);
  const [disc, ring, stroke, rect] = [...svg.children];

  it("is a hidden SVG in the frame's base pixels", () => {
    expect([svg.namespaceURI, svg.localName]).toEqual(["http://www.w3.org/2000/svg", "svg"]);
    expect(attributes(svg, ["viewBox", "aria-hidden", "focusable"])).toEqual({
      "aria-hidden": "true",
      focusable: "false",
      viewBox: "0 0 75 35",
    });
  });

  it("paints the layers in order", () => {
    expect([...svg.children].map((child) => child.localName)).toEqual([
      "circle",
      "circle",
      "path",
      "rect",
    ]);
  });

  it("draws a disc as a filled circle", () => {
    expect(attributes(disc!, ["cx", "cy", "r", "fill"])).toEqual({
      cx: "17.5",
      cy: "17.5",
      fill: "#181425",
      r: "16.5",
    });
  });

  it("draws a ring as a circle stroked between its radii", () => {
    expect(attributes(ring!, ["r", "fill", "stroke", "stroke-width"])).toEqual({
      fill: "none",
      r: "34",
      stroke: "#ead4aa",
      "stroke-width": "3",
    });
  });

  it("draws a stroke as a round-capped path", () => {
    expect(attributes(stroke!, ["d", "stroke", "stroke-width", "stroke-linecap"])).toEqual({
      d: "M18 34 L13 37.5",
      stroke: "#0000ff",
      "stroke-linecap": "round",
      "stroke-width": "4",
    });
  });

  it("draws a rect as a filled rect", () => {
    expect(attributes(rect!, ["x", "y", "width", "height", "fill"])).toEqual({
      fill: "#ffffff",
      height: "13",
      width: "4",
      x: "12",
      y: "11",
    });
  });
});
