import type { Rect } from "../../../rect.ts";
import {
  type LayoutColumnSizing,
  type LayoutMeasurement,
  type LayoutNode,
  type LayoutPath,
  type LayoutReport,
  layoutReport,
  type LayoutSchema,
  type LayoutSlots,
  validateLayoutTree,
} from "../../../ui/index.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";

export interface LayoutPart<Props, Slot extends string> {
  readonly element: HTMLElement;
  readonly slots: Readonly<Record<Slot, HTMLElement>>;
  update(props: Props): void;
  dispose(): void;
}

export interface LayoutComponentPort<Props, Slot extends string> {
  readonly slots: readonly Slot[];
  create(props: Props): LayoutPart<Props, Slot>;
}

export type LayoutComponentPorts<S extends LayoutSchema> = {
  readonly [K in keyof S]: LayoutComponentPort<S[K]["props"], S[K]["slots"]>;
};

export interface LayoutMeasureContext {
  readonly path: LayoutPath;
  readonly viewport: Rect;
}

export interface LayoutOptions<S extends LayoutSchema> {
  readonly host: HTMLElement;
  readonly components: LayoutComponentPorts<S>;
  // Measure actual fonts, line boxes, ink, clip ancestors and disjoint peer overlaps after art
  // settles. Return null while physical evidence is unavailable; DOM zero rects are not proof.
  readonly measure?: (
    context: LayoutMeasureContext,
    element: HTMLElement,
  ) => LayoutMeasurement | null;
  readonly restoreFocus?: (removedPath: LayoutPath) => void;
}

export interface MountedLayout<S extends LayoutSchema> {
  update(tree: LayoutNode<S>): void;
  inspect(viewport: Rect): LayoutReport;
  dispose(): void;
}

interface Instance<S extends LayoutSchema> {
  node: LayoutNode<S>;
  readonly element: HTMLElement;
  readonly part: LayoutPart<unknown, string> | undefined;
  readonly groups: Map<string, Map<string, Instance<S>>>;
}

function columnTracks(count: number, sizing: LayoutColumnSizing): string {
  if (count === 0) {
    return "none";
  }
  if (sizing.mode !== "tracks") {
    const track = sizing.mode === "equal" ? "minmax(0, 1fr)" : "max-content";
    return `repeat(${count}, ${track})`;
  }
  return sizing.tracks
    .map((track) => {
      if (track.kind === "fraction") {
        return "minmax(0, 1fr)";
      }
      return track.kind === "intrinsic"
        ? "max-content"
        : `calc(${track.size} * var(--ui-unit, 1) * 1px)`;
    })
    .join(" ");
}

// Composes caller factories and their actual DOM slots. No alternate mock renderer, action
// registry, modal lifecycle or game styling is supplied here. The host's existing content stays.
export function mountLayout<S extends LayoutSchema>(
  options: LayoutOptions<S>,
  tree: LayoutNode<S>,
): MountedLayout<S> {
  const { components, host } = options;
  const slots = Object.fromEntries(
    Object.entries(components).map(([name, port]) => [name, port.slots]),
  ) as LayoutSlots<S>;
  let root: Instance<S> | undefined;
  let disposed = false;
  let active: HTMLElement | undefined;
  let removedFocus: LayoutPath | undefined;

  const remove = (path: LayoutPath, instance: Instance<S>): void => {
    if (active !== undefined && instance.element.contains(active)) {
      removedFocus ??= [...path];
    }
    for (const [group, children] of instance.groups) {
      for (const child of children.values()) {
        remove(
          instance.node.kind === "component"
            ? [...path, group, child.node.key]
            : [...path, child.node.key],
          child,
        );
      }
    }
    instance.part?.dispose();
    instance.element.remove();
  };

  const children = (
    parent: HTMLElement,
    path: LayoutPath,
    previous: Map<string, Instance<S>>,
    nodes: readonly LayoutNode<S>[],
  ): Map<string, Instance<S>> => {
    const next = new Map<string, Instance<S>>();
    for (const node of nodes) {
      next.set(node.key, reconcile([...path, node.key], previous.get(node.key), node));
    }
    for (const [key, instance] of previous) {
      if (!next.has(key)) {
        remove([...path, key], instance);
      }
    }
    // Insert only where order differs; unchanged keyed components never detach.
    let before: ChildNode | null = null;
    for (const instance of [...next.values()].reverse()) {
      if (instance.element.parentNode !== parent || instance.element.nextSibling !== before) {
        parent.insertBefore(instance.element, before);
      }
      before = instance.element;
    }
    return next;
  };

  const create = (node: LayoutNode<S>): Instance<S> => {
    if (node.kind !== "component") {
      const element = host.ownerDocument.createElement("div");
      element.className = `ui-layout-${node.kind}`;
      return { element, groups: new Map(), node, part: undefined };
    }
    // The mapped public type couples each component name to its props and slots. Erase that
    // coupling only at this private dispatch boundary, after whole-tree validation.
    const port = components[node.component] as LayoutComponentPort<unknown, string>;
    const part = port.create(node.props);
    const destinations = new Set<HTMLElement>();
    for (const name of port.slots) {
      const slot = part.slots[name];
      if (slot === undefined || !part.element.contains(slot) || destinations.has(slot)) {
        part.dispose();
        throw new RangeError("Component slots must be distinct elements within its root");
      }
      destinations.add(slot);
    }
    return { element: part.element, groups: new Map(), node, part };
  };

  const reconcile = (
    path: LayoutPath,
    previous: Instance<S> | undefined,
    node: LayoutNode<S>,
  ): Instance<S> => {
    let instance = previous;
    if (
      instance !== undefined &&
      (instance.node.key !== node.key ||
        instance.node.kind !== node.kind ||
        (instance.node.kind === "component" &&
          node.kind === "component" &&
          instance.node.component !== node.component))
    ) {
      remove([...path.slice(0, -1), instance.node.key], instance);
      instance = undefined;
    }
    const retained = instance !== undefined;
    instance ??= create(node);
    if (node.kind === "component") {
      if (retained) {
        instance.part!.update(node.props);
      }
      const declared = slots[node.component]!;
      for (const name of declared) {
        const nodes =
          (node.slots as Readonly<Record<string, readonly LayoutNode<S>[]>> | undefined)?.[name] ??
          [];
        instance.groups.set(
          name,
          children(
            instance.part!.slots[name]!,
            [...path, name],
            instance.groups.get(name) ?? new Map(),
            nodes,
          ),
        );
      }
    } else {
      writeLayoutProperties(
        {
          "--ui-layout-columns": Math.max(1, node.children.length),
          "--ui-layout-gap": node.gap,
          "--ui-layout-padding": node.padding,
        },
        instance.element,
      );
      instance.element.setAttribute("data-ui-layout-align", node.align ?? "top");
      if (node.kind === "columns" && node.sizing !== undefined) {
        writeLayoutProperties(
          { "--ui-layout-tracks": columnTracks(node.children.length, node.sizing) },
          instance.element,
        );
        instance.element.setAttribute("data-ui-layout-sizing", node.sizing.mode);
      } else {
        instance.element.style.removeProperty("--ui-layout-tracks");
        instance.element.removeAttribute("data-ui-layout-sizing");
      }
      instance.groups.set(
        "",
        children(instance.element, path, instance.groups.get("") ?? new Map(), node.children),
      );
    }
    instance.node = node;
    return instance;
  };

  const assertLive = () => {
    if (disposed) {
      throw new Error("Layout has been disposed");
    }
  };

  const update = (next: LayoutNode<S>) => {
    assertLive();
    validateLayoutTree(slots, next);
    const focused = host.ownerDocument.activeElement;
    active = focused !== null && host.contains(focused) ? (focused as HTMLElement) : undefined;
    removedFocus = undefined;
    root = reconcile([next.key], root, next);
    if (root.element.parentNode !== host) {
      host.append(root.element);
    }
    if (active !== undefined && host.contains(active)) {
      if (host.ownerDocument.activeElement !== active) {
        active.focus({ preventScroll: true });
      }
    } else if (removedFocus !== undefined) {
      options.restoreFocus?.(removedFocus);
    }
    active = undefined;
  };

  update(tree);
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (root !== undefined) {
        remove([root.node.key], root);
      }
      root = undefined;
    },
    inspect(viewport) {
      assertLive();
      const observations: { path: LayoutPath; measurement: LayoutMeasurement | null }[] = [];
      const visit = (path: LayoutPath, instance: Instance<S>): void => {
        const measurement =
          options.measure?.({ path: [...path], viewport: { ...viewport } }, instance.element) ??
          null;
        observations.push({ measurement, path });
        for (const [group, descendants] of instance.groups) {
          for (const child of descendants.values()) {
            visit(
              instance.node.kind === "component"
                ? [...path, group, child.node.key]
                : [...path, child.node.key],
              child,
            );
          }
        }
      };
      if (root !== undefined) {
        visit([root.node.key], root);
      }
      return layoutReport(viewport, observations);
    },
    update,
  };
}
