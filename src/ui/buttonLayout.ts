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

// Insets from the outer artwork bounds to its label-bearing face, in caller units.
export interface ButtonFaceInsets {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

const NO_FACE_INSETS: ButtonFaceInsets = { bottom: 0, left: 0, right: 0, top: 0 };

export interface ButtonLayoutContext {
  readonly bounds: Rect;
  readonly faceInsets?: ButtonFaceInsets;
  readonly footerBaseline?: number;
  readonly metrics: ButtonMetrics;
  readonly placement?: ButtonPlacement;
  readonly size: ButtonSize;
}

export interface ButtonLayout {
  readonly face: Rect;
  readonly label: Rect;
  readonly outer: Rect;
  readonly role: ButtonRole;
}

function nonnegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
}

function validateRole(role: ButtonRole): void {
  if (role !== "primary" && role !== "secondary" && role !== "navigation") {
    throw new RangeError("Unknown button role");
  }
}

// Retain actions and navigation without a section, including caller metadata and ordering.
export function withoutCurrentNavigation<
  Section,
  Button extends {
    readonly role: ButtonRole;
    readonly section?: Section;
  },
>(current: Section, buttons: readonly Button[]): Button[] {
  return buttons.filter((button) => {
    validateRole(button.role);
    return (
      button.role !== "navigation" || button.section === undefined || button.section !== current
    );
  });
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
}

function validateInsets(insets: ButtonFaceInsets): void {
  for (const side of ["top", "right", "bottom", "left"] as const) {
    nonnegative(`faceInsets.${side}`, insets[side]);
  }
  nonnegative("horizontal face insets", insets.left + insets.right);
  nonnegative("vertical face insets", insets.top + insets.bottom);
}

function requiredSize(
  metrics: ButtonMetrics,
  insets: ButtonFaceInsets,
  label: ButtonSize,
): ButtonSize {
  validateSize("label", label);
  const size = {
    height: Math.max(
      metrics.height,
      label.height + 2 * metrics.paddingY + insets.top + insets.bottom,
    ),
    width: Math.max(
      metrics.minWidth,
      label.width + 2 * metrics.paddingX + insets.left + insets.right,
    ),
  };
  validateSize("required size", size);
  return size;
}

function faceSize(insets: ButtonFaceInsets, size: ButtonSize): ButtonSize {
  const face = {
    height: size.height - insets.top - insets.bottom,
    width: size.width - insets.left - insets.right,
  };
  if (face.height <= 0 || face.width <= 0) {
    throw new RangeError("Button must have a usable face inside its outer bounds");
  }
  return face;
}

// Use the returned size for every member of a repeated group. Empty groups still return the
// token's minimum padded outer size. Measured wrapped labels grow the shared height beyond the
// token minimum. Labels never wrap, shrink or clip here; wrapping belongs to the caller.
export function buttonGroupSize(
  tokens: Readonly<Record<string, ButtonMetrics>>,
  group: {
    readonly faceInsets?: ButtonFaceInsets;
    readonly labels: readonly ButtonSize[];
    readonly size: string;
  },
): ButtonSize {
  if (!Object.hasOwn(tokens, group.size)) {
    throw new RangeError(`Unknown button size: ${group.size}`);
  }
  const metrics = tokens[group.size]!;
  validateMetrics(metrics);
  const insets = group.faceInsets ?? NO_FACE_INSETS;
  validateInsets(insets);
  let { height, width } = requiredSize(metrics, insets, { height: 0, width: 0 });
  for (const label of group.labels) {
    const required = requiredSize(metrics, insets, label);
    height = Math.max(height, required.height);
    width = Math.max(width, required.width);
  }
  const size = { height, width };
  faceSize(insets, size);
  return size;
}

// Bounds are the caller's control region within a row pill or footer, already excluding related
// text and row padding. Face insets exclude artwork such as a bottom lip from label centering.
// The label is a measured line box, centred on both axes inside the face. Top aligns the outer
// bounds with the region's text top. Footer requires an explicit target baseline in caller
// coordinates and a font-measured baseline offset from the label's top. Invalid input or overflow
// throws RangeError instead of escaping the region. Negative coordinate origins are valid.
export function layoutButton(
  context: ButtonLayoutContext,
  button: {
    readonly label: ButtonSize;
    readonly labelBaselineOffset?: number;
    readonly role: ButtonRole;
  },
): ButtonLayout {
  const { bounds, metrics, placement = "top", size } = context;
  validateRole(button.role);
  validateMetrics(metrics);
  validateSize("bounds", bounds);
  validateSize("size", size);
  const insets = context.faceInsets ?? NO_FACE_INSETS;
  validateInsets(insets);
  const faceDimensions = faceSize(insets, size);
  for (const edge of [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height]) {
    if (!Number.isFinite(edge)) {
      throw new RangeError("Bounds edges must be finite");
    }
  }
  const required = requiredSize(metrics, insets, button.label);
  if (size.height < required.height || size.width < required.width) {
    throw new RangeError(
      "Button size must meet token minimums and contain the padded label and insets",
    );
  }
  if (size.width > bounds.width || size.height > bounds.height) {
    throw new RangeError("Button exceeds its control region");
  }
  if (placement !== "top" && placement !== "center" && placement !== "footer") {
    throw new RangeError("Unknown button placement");
  }
  const { labelBaselineOffset } = button;
  if (labelBaselineOffset !== undefined) {
    nonnegative("labelBaselineOffset", labelBaselineOffset);
    if (labelBaselineOffset > button.label.height) {
      throw new RangeError("Label baseline offset exceeds its measured line box");
    }
  }
  let y = bounds.y + (placement === "center" ? (bounds.height - size.height) / 2 : 0);
  if (placement === "footer") {
    const { footerBaseline } = context;
    if (
      footerBaseline === undefined ||
      !Number.isFinite(footerBaseline) ||
      labelBaselineOffset === undefined
    ) {
      throw new RangeError(
        "Footer requires a finite target baseline and measured label baseline offset",
      );
    }
    y =
      footerBaseline -
      labelBaselineOffset -
      (faceDimensions.height - button.label.height) / 2 -
      insets.top;
  }
  if (!Number.isFinite(y) || y < bounds.y || y + size.height > bounds.y + bounds.height) {
    throw new RangeError("Button outer bounds exceed its control region");
  }
  const outer: Rect = {
    height: size.height,
    width: size.width,
    x: bounds.x + (bounds.width - size.width) / 2,
    y,
  };
  const face: Rect = {
    ...faceDimensions,
    x: outer.x + insets.left,
    y: outer.y + insets.top,
  };
  return {
    face,
    label: {
      height: button.label.height,
      width: button.label.width,
      x: face.x + (face.width - button.label.width) / 2,
      y: face.y + (face.height - button.label.height) / 2,
    },
    outer,
    role: button.role,
  };
}
