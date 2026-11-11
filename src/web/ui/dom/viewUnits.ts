import type { Rect } from "../../../rect.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";

// The view-units bridge gives the DOM UI the canvas's scale, so UI CSS reads and writes base
// pixels only and nothing is transform-scaled: text stays crisp and hit testing native. It sets,
// on the UI layer (ui.css .ui-layer):
// - --ui-unit: CSS px per base pixel, unitless. One base pixel is calc(var(--ui-unit) * 1px).
// - --ui-view-left, --ui-view-top, --ui-view-width, --ui-view-height: the play view's box in the
//   layer, in CSS px, which ui.css .ui-view takes.
// - --ui-slice-<edge>: each nine-slice edge, in base px, as whole CSS px, round(edge * unit) and
//   at least 1, so frame borders land on whole pixels.

export const UI_UNIT = "--ui-unit";

export const VIEW_PROPERTIES = {
  height: "--ui-view-height",
  left: "--ui-view-left",
  top: "--ui-view-top",
  width: "--ui-view-width",
} as const;

// What the game measured: its CSS px per base pixel, and its play view in the layer, in CSS px.
export interface ViewFit {
  readonly unit: number;
  readonly view: Rect;
}

function checkEdge(edge: number): void {
  if (!Number.isInteger(edge) || edge < 0) {
    throw new RangeError(`A nine-slice edge must be a whole number of base px, not ${edge}`);
  }
}

// The custom property that holds a nine-slice edge, in base px, as whole CSS px.
export function sliceProperty(edge: number): string {
  checkEdge(edge);
  return `--ui-slice-${edge}`;
}

// The bridge's custom properties for fit, with the nine-slice edges.
export function viewProperties(edges: readonly number[], fit: ViewFit): Record<string, string> {
  const { unit, view } = fit;
  return {
    [UI_UNIT]: String(unit),
    [VIEW_PROPERTIES.height]: `${view.height}px`,
    [VIEW_PROPERTIES.left]: `${view.x}px`,
    [VIEW_PROPERTIES.top]: `${view.y}px`,
    [VIEW_PROPERTIES.width]: `${view.width}px`,
    ...Object.fromEntries(
      edges.map((edge) => [sliceProperty(edge), `${Math.max(1, Math.round(edge * unit))}px`]),
    ),
  };
}

// Keeps layer's view properties current. The returned update takes each new fit (call it on the
// scale manager's resize and on a frame turn) and returns whether any property changed; it
// ignores a fit whose unit is not a positive finite number, as before the canvas has a size.
export function createViewUnits(
  edges: readonly number[],
  layer: ElementCSSInlineStyle,
): (fit: ViewFit) => boolean {
  edges.forEach(checkEdge);
  return (fit) =>
    Number.isFinite(fit.unit) &&
    fit.unit > 0 &&
    writeLayoutProperties(viewProperties(edges, fit), layer);
}

// A length of value base px. Zero stays a length, so it is valid inside max() and calc().
export function units(value: number): string {
  return value === 0 ? "0px" : `calc(var(${UI_UNIT}) * ${value}px)`;
}

// A length offset base px in from the edge a custom property holds as unitless base px (as
// layoutProperties writes it); a negative offset reaches past the edge.
export function fromEdge(property: string, offset = 0): string {
  const edge = `var(${property})`;
  if (offset === 0) {
    return `calc(var(${UI_UNIT}) * ${edge} * 1px)`;
  }
  const sign = offset < 0 ? "-" : "+";
  return `calc(var(${UI_UNIT}) * (${edge} ${sign} ${Math.abs(offset)}) * 1px)`;
}

// A nine-slice edge of edge base px, as the whole CSS px the bridge sets.
export function slice(edge: number): string {
  return `var(${sliceProperty(edge)})`;
}

// The unit in effect at element; 1 before the bridge has set it.
export function readUnit(element: Element): number {
  const view = element.ownerDocument.defaultView;
  const value = parseFloat(view?.getComputedStyle(element).getPropertyValue(UI_UNIT) ?? "");
  return Number.isFinite(value) && value > 0 ? value : 1;
}
