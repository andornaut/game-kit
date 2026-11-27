import type { Rect } from "../../rect.ts";

export type LayoutSchema = Record<string, { readonly props: unknown; readonly slots: string }>;
export type LayoutPath = readonly string[];
export type LayoutAlignment = "top" | "center" | "baseline";

export type LayoutColumnTrack =
  | { readonly kind: "fraction" }
  | { readonly kind: "intrinsic" }
  // Fixed sizes use caller logical units, scaled by the renderer's ui-unit.
  | { readonly kind: "fixed"; readonly size: number };

export type LayoutColumnSizing =
  | { readonly mode: "equal" | "intrinsic" }
  | { readonly mode: "tracks"; readonly tracks: readonly LayoutColumnTrack[] };

export type ComponentNode<S extends LayoutSchema> = {
  [K in keyof S & string]: {
    readonly kind: "component";
    readonly key: string;
    readonly component: K;
    readonly props: S[K]["props"];
    readonly slots?: S[K]["slots"] extends never
      ? never
      : Readonly<Partial<Record<S[K]["slots"], readonly LayoutNode<S>[]>>>;
  };
}[keyof S & string];

export type LayoutNode<S extends LayoutSchema> =
  | ComponentNode<S>
  | ({
      readonly key: string;
      readonly gap: number;
      readonly padding: number;
      readonly align?: LayoutAlignment;
      readonly children: readonly LayoutNode<S>[];
    } & (
      | { readonly kind: "row" | "stack"; readonly sizing?: never }
      | { readonly kind: "columns"; readonly sizing?: LayoutColumnSizing }
    ));

export type LayoutSlots<S extends LayoutSchema> = {
  readonly [K in keyof S]: readonly S[K]["slots"][];
};

function nonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateColumnSizing(
  count: number,
  gap: number,
  padding: number,
  sizing: LayoutColumnSizing,
): void {
  let fixedExtent = gap * Math.max(0, count - 1) + padding * 2;
  if (sizing === null || typeof sizing !== "object") {
    throw new RangeError("Invalid column sizing");
  }
  if (sizing.mode === "equal" || sizing.mode === "intrinsic") {
    if (Object.hasOwn(sizing, "tracks")) {
      throw new RangeError("Column tracks require tracks mode");
    }
  } else if (sizing.mode === "tracks") {
    if (!Array.isArray(sizing.tracks) || sizing.tracks.length !== count) {
      throw new RangeError("Column tracks must match the child count");
    }
    for (const track of sizing.tracks) {
      if (track === null || typeof track !== "object") {
        throw new RangeError("Invalid column track");
      }
      if (track.kind === "fixed") {
        if (!nonnegative(track.size)) {
          throw new RangeError("Fixed column size must be finite and nonnegative");
        }
        fixedExtent += track.size;
      } else if (
        (track.kind !== "fraction" && track.kind !== "intrinsic") ||
        Object.hasOwn(track, "size")
      ) {
        throw new RangeError("Unknown column track or unsupported size");
      }
    }
  } else {
    throw new RangeError("Unknown column sizing mode");
  }
  if (!Number.isFinite(fixedExtent)) {
    throw new RangeError("Column fixed extent must be finite");
  }
}

function validRect(rect: Rect | null | undefined): boolean {
  return (
    rect !== null &&
    rect !== undefined &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    nonnegative(rect.width) &&
    nonnegative(rect.height) &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}

// Slot names come from the caller's component ports. Validate the whole tree before rendering.
// Keys are unique among siblings in each container or named slot, not across the whole tree.
export function validateLayoutTree<S extends LayoutSchema>(
  slots: LayoutSlots<S>,
  tree: LayoutNode<S>,
): void {
  const ancestors = new Set<LayoutNode<S>>();
  const siblings = (nodes: readonly LayoutNode<S>[]) => {
    const keys = new Set<string>();
    for (const node of nodes) {
      if (typeof node.key !== "string" || node.key.length === 0 || keys.has(node.key)) {
        throw new RangeError("Layout keys must be nonempty and unique among siblings");
      }
      keys.add(node.key);
      if (ancestors.has(node)) {
        throw new RangeError("Cyclic layout tree");
      }
      ancestors.add(node);
      if (node.kind !== "columns" && Object.hasOwn(node, "sizing")) {
        throw new RangeError("Column sizing is only supported on columns");
      }
      if (node.kind === "component") {
        if (!Object.hasOwn(slots, node.component)) {
          throw new RangeError(`Unknown layout component: ${node.component}`);
        }
        const declared = slots[node.component]!;
        if (new Set(declared).size !== declared.length) {
          throw new RangeError("Component ports must declare distinct slot names");
        }
        for (const [name, children] of Object.entries(node.slots ?? {})) {
          if (!declared.includes(name)) {
            throw new RangeError(`Unknown component slot: ${name}`);
          }
          siblings(children as readonly LayoutNode<S>[]);
        }
      } else {
        if (node.kind !== "row" && node.kind !== "stack" && node.kind !== "columns") {
          throw new RangeError("Unknown layout node kind");
        }
        if (!nonnegative(node.gap) || !nonnegative(node.padding)) {
          throw new RangeError("Layout gap and padding must be finite and nonnegative");
        }
        if (
          node.align !== undefined &&
          node.align !== "top" &&
          node.align !== "center" &&
          node.align !== "baseline"
        ) {
          throw new RangeError("Unknown layout alignment");
        }
        if (node.kind === "columns") {
          if (node.sizing !== undefined) {
            validateColumnSizing(node.children.length, node.gap, node.padding, node.sizing);
          }
        }
        siblings(node.children);
      }
      ancestors.delete(node);
    }
  };
  siblings([tree]);
}

// Physical measurements are supplied by the actual renderer, in one caller coordinate system.
// An empty wrappedLines/overlaps array means measured absence, not missing evidence.
export interface LayoutMeasurement {
  readonly available: Rect;
  readonly required: Rect;
  readonly wrappedLines: readonly Rect[];
  readonly clipped: boolean;
  readonly overlaps: readonly LayoutPath[];
}

export interface LayoutObservation {
  readonly path: LayoutPath;
  readonly measurement: LayoutMeasurement | null;
}

export interface LayoutDiagnostic {
  readonly kind: "overflow" | "clip" | "overlap" | "unavailable";
  readonly path: LayoutPath;
  readonly viewport: Rect;
  readonly available: Rect | null;
  readonly required: Rect | null;
  readonly wrappedLines: readonly Rect[];
  readonly relatedPath?: LayoutPath;
}

export interface LayoutReport {
  readonly status: "fit" | "overflow" | "unavailable";
  readonly diagnostics: readonly LayoutDiagnostic[];
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Missing or invalid measurements take precedence over fit/overflow; known failures remain in
// diagnostics. This does not infer physical layout from a tree or a headless DOM's zero rects.
export function layoutReport(
  viewport: Rect,
  observations: readonly LayoutObservation[],
): LayoutReport {
  if (!validRect(viewport)) {
    throw new RangeError("Invalid layout viewport");
  }
  const diagnostics: LayoutDiagnostic[] = [];
  for (const { measurement, path } of observations) {
    if (
      measurement === null ||
      !validRect(measurement.available) ||
      !validRect(measurement.required) ||
      !Array.isArray(measurement.wrappedLines) ||
      !measurement.wrappedLines.every(validRect) ||
      typeof measurement.clipped !== "boolean" ||
      !Array.isArray(measurement.overlaps) ||
      !measurement.overlaps.every(
        (other) =>
          Array.isArray(other) && other.length > 0 && other.every((key) => typeof key === "string"),
      )
    ) {
      diagnostics.push({
        available: null,
        kind: "unavailable",
        path: [...path],
        required: null,
        viewport: { ...viewport },
        wrappedLines: [],
      });
      continue;
    }
    const evidence = {
      available: { ...measurement.available },
      path: [...path],
      required: { ...measurement.required },
      viewport: { ...viewport },
      wrappedLines: measurement.wrappedLines.map((line) => ({ ...line })),
    };
    if (
      [measurement.required, ...measurement.wrappedLines].some(
        (rect) => !contains(measurement.available, rect) || !contains(viewport, rect),
      )
    ) {
      diagnostics.push({ ...evidence, kind: "overflow" });
    }
    if (measurement.clipped) {
      diagnostics.push({ ...evidence, kind: "clip" });
    }
    for (const other of measurement.overlaps) {
      diagnostics.push({ ...evidence, kind: "overlap", relatedPath: [...other] });
    }
  }
  // No observations cannot establish that anything was measured.
  if (observations.length === 0) {
    diagnostics.push({
      available: null,
      kind: "unavailable",
      path: [],
      required: null,
      viewport: { ...viewport },
      wrappedLines: [],
    });
  }
  return {
    diagnostics,
    status: diagnostics.some(({ kind }) => kind === "unavailable")
      ? "unavailable"
      : diagnostics.length > 0
        ? "overflow"
        : "fit",
  };
}
