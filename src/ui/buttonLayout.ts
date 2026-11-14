import type { Rect } from "../rect.ts";

export type ButtonSize = Readonly<Pick<Rect, "width" | "height">>;
export type ButtonRole = "primary" | "secondary" | "navigation";
export type ButtonPlacement = "top" | "center" | "footer";

// Named metrics, measurements and coordinate units belong to the caller.
export interface ButtonMetrics {
  readonly height: number;
  readonly minWidth: number;
  readonly paddingX: number;
  readonly paddingY: number;
}

export interface ButtonLayoutContext {
  readonly bounds: Rect;
  readonly metrics: ButtonMetrics;
  readonly placement?: ButtonPlacement;
  readonly size: ButtonSize;
}

export interface ButtonLayout {
  readonly face: Rect;
  readonly label: Rect;
  readonly role: ButtonRole;
}

function nonnegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
}

function validateSize(name: string, size: ButtonSize): void {
  nonnegative(`${name}.width`, size.width);
  nonnegative(`${name}.height`, size.height);
}

function validateMetrics(metrics: ButtonMetrics): void {
  nonnegative("metrics.height", metrics.height);
  nonnegative("metrics.minWidth", metrics.minWidth);
  nonnegative("metrics.paddingX", metrics.paddingX);
  nonnegative("metrics.paddingY", metrics.paddingY);
  if (2 * metrics.paddingY > metrics.height) {
    throw new RangeError("Vertical padding exceeds button height");
  }
}

function paddedWidth(metrics: ButtonMetrics, label: ButtonSize): number {
  validateSize("label", label);
  if (label.height + 2 * metrics.paddingY > metrics.height) {
    throw new RangeError("Label and padding exceed button height");
  }
  const width = Math.max(metrics.minWidth, label.width + 2 * metrics.paddingX);
  nonnegative("padded width", width);
  return width;
}

// Use the returned size for every member of a repeated group. Empty groups still return the
// token's minimum padded face size. Labels never wrap, shrink or clip here.
export function buttonGroupSize(
  tokens: Readonly<Record<string, ButtonMetrics>>,
  group: { readonly size: string; readonly labels: readonly ButtonSize[] },
): ButtonSize {
  if (!Object.hasOwn(tokens, group.size)) {
    throw new RangeError(`Unknown button size: ${group.size}`);
  }
  const metrics = tokens[group.size]!;
  validateMetrics(metrics);
  let width = paddedWidth(metrics, { height: 0, width: 0 });
  for (const label of group.labels) {
    width = Math.max(width, paddedWidth(metrics, label));
  }
  return { height: metrics.height, width };
}

// Bounds are the caller's control region within a row pill or footer, already excluding related
// text and insets. Top aligns with that region's text top; footer aligns equal-height faces at
// its bottom. Font baselines remain caller-owned. Invalid input or overflow throws RangeError
// rather than returning a face or padded label outside its region. Negative origins are valid.
export function layoutButton(
  context: ButtonLayoutContext,
  button: { readonly label: ButtonSize; readonly role: ButtonRole },
): ButtonLayout {
  const { bounds, metrics, placement = "top", size } = context;
  validateMetrics(metrics);
  validateSize("bounds", bounds);
  validateSize("size", size);
  for (const edge of [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height]) {
    if (!Number.isFinite(edge)) {
      throw new RangeError("Bounds edges must be finite");
    }
  }
  if (size.height !== metrics.height || size.width < paddedWidth(metrics, button.label)) {
    throw new RangeError("Button size must preserve token height and contain the padded label");
  }
  if (size.width > bounds.width || size.height > bounds.height) {
    throw new RangeError("Button exceeds its control region");
  }
  if (placement !== "top" && placement !== "center" && placement !== "footer") {
    throw new RangeError("Unknown button placement");
  }
  const face: Rect = {
    height: size.height,
    width: size.width,
    x: bounds.x + (bounds.width - size.width) / 2,
    y:
      bounds.y +
      (placement === "top"
        ? 0
        : placement === "center"
          ? (bounds.height - size.height) / 2
          : bounds.height - size.height),
  };
  return {
    face,
    label: {
      height: button.label.height,
      width: button.label.width,
      x: face.x + (face.width - button.label.width) / 2,
      y: face.y + (face.height - button.label.height) / 2,
    },
    role: button.role,
  };
}
