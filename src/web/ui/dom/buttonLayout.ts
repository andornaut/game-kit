import {
  type ButtonFaceInsets,
  buttonGroupSize,
  type ButtonMetrics,
  type ButtonPlacement,
  type ButtonRole,
} from "../../../ui/buttonLayout.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";

export interface ButtonFrameContext {
  // Logical artwork units, excluding the lip or other non-face artwork.
  readonly faceInsets: ButtonFaceInsets;
  // Actual CSS border widths in CSS pixels, already rounded by the caller's skin.
  // Omit for borderless controls. This adapter never changes the native border or transform.
  readonly borderWidths?: ButtonFaceInsets;
}

// Apply on the control or its group. Reapply rounded border widths when the view unit changes.
// Each scaled face inset plus metrics padding must cover that side's actual border width.
export function setButtonFrame(context: ButtonFrameContext, element: HTMLElement): boolean {
  const values: Record<string, number | string> = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const inset = context.faceInsets[side];
    const border = context.borderWidths?.[side] ?? 0;
    if (!Number.isFinite(inset) || inset < 0 || !Number.isFinite(border) || border < 0) {
      throw new RangeError("Face insets and CSS border widths must be finite and nonnegative");
    }
    values[`--ui-button-face-${side}`] = inset;
    values[`--ui-button-border-${side}`] = `${border}px`;
  }
  return writeLayoutProperties(values, element);
}

// Size tokens are shared data for a game's mock renderer and DOM. Apply a size on a group so
// each button inherits it, or on an individual control. Classes and content remain caller-owned.
// Wrapped baseline groups supply measured label line boxes in logical units after font/layout
// changes. Their common minimum comes from the same pure sizing context as the mock renderer.
export type ButtonGroupContext = Parameters<typeof buttonGroupSize>[1];

export function setButtonSize(
  tokens: Readonly<Record<string, ButtonMetrics>>,
  selection: string | ButtonGroupContext,
  element: HTMLElement,
): boolean {
  const group = typeof selection === "string" ? { labels: [], size: selection } : selection;
  const minimum = buttonGroupSize(tokens, group);
  const metrics = tokens[group.size]!;
  const changed = writeLayoutProperties(
    {
      "--ui-button-height": minimum.height,
      "--ui-button-min-width": minimum.width,
      "--ui-button-padding-x": metrics.paddingX,
      "--ui-button-padding-y": metrics.paddingY,
    },
    element,
  );
  const renamed = element.getAttribute("data-ui-size") !== group.size;
  element.setAttribute("data-ui-size", group.size);
  return changed || renamed;
}

// These are presentation roles, not ARIA roles. The game supplies their faces and colours.
export function setButtonRole(role: ButtonRole, element: HTMLElement): void {
  if (role !== "primary" && role !== "secondary" && role !== "navigation") {
    throw new RangeError("Unknown button role");
  }
  element.setAttribute("data-ui-button-role", role);
}

// Top is the stylesheet's default. Center is for compact quantity rows; footer aligns the
// inherited font's baseline. This never changes the label's centering inside the button.
export function setControlPlacement(placement: ButtonPlacement, element: HTMLElement): void {
  if (placement !== "top" && placement !== "center" && placement !== "footer") {
    throw new RangeError("Unknown button placement");
  }
  element.setAttribute("data-ui-placement", placement);
}
