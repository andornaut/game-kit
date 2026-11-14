import type { Point } from "../rect.ts";

export type ControlAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "omitted" };

export interface ControlPresentation {
  readonly executable: boolean;
  readonly reason?: string;
  readonly visible: boolean;
}

export interface PageDividerStyle {
  readonly colour: number;
  readonly thickness: number;
}

export interface DisclosureStyle {
  readonly colour: number;
  readonly height: number;
  readonly strokeWidth: number;
  readonly width: number;
}

// Callers determine relevance and requirements. An unmet requirement is visible, with a reason.
export function controlPresentation(state: ControlAvailability): ControlPresentation {
  switch (state.kind) {
    case "available":
      return { executable: true, visible: true };
    case "omitted":
      return { executable: false, visible: false };
    case "unavailable":
      if (typeof state.reason !== "string" || state.reason.trim().length === 0) {
        throw new RangeError("Unavailable controls require a nonempty reason");
      }
      return { executable: false, reason: state.reason, visible: true };
    default:
      throw new RangeError("Unknown control availability");
  }
}

// Recheck the current state at invocation, including keyboard and programmatic action paths.
export function invokeControl(state: ControlAvailability, action: () => void): boolean {
  if (!controlPresentation(state).executable) {
    return false;
  }
  action();
  return true;
}

export function validatePageDivider(style: PageDividerStyle): void {
  validateColour(style.colour);
  positive("Divider thickness", style.thickness);
}

function validateColour(colour: number): void {
  if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff) {
    throw new RangeError("Colour must be an RGB integer");
  }
}

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

// A right disclosure mark, inset by half its stroke so the whole stroke fits the authored box.
export function disclosurePath(style: DisclosureStyle): readonly Point[] {
  validateColour(style.colour);
  positive("Disclosure width", style.width);
  positive("Disclosure height", style.height);
  positive("Disclosure stroke width", style.strokeWidth);
  if (style.strokeWidth >= Math.min(style.width, style.height)) {
    throw new RangeError("Disclosure stroke must leave a nonempty mark");
  }
  const inset = style.strokeWidth / 2;
  return [
    { x: inset, y: inset },
    { x: style.width - inset, y: style.height / 2 },
    { x: inset, y: style.height - inset },
  ];
}
