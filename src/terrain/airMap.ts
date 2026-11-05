import { type Point, type Rect, rectsOverlap } from "../rect.ts";
import { fnv1a64 } from "./fnv1a64.ts";

// A flyer's hitbox size and its offset from the actor position, in pixels; `speed` is
// pixels/second and `cell` is the grid step in tiles.
export interface FlightProfile {
  readonly body: Readonly<Pick<Rect, "height" | "width">> & { readonly offset: Point };
  readonly speed: number;
  readonly cell: number;
}

// `tileSize` is pixels per tile. `axisChangeSeconds` is the search cost added where a route
// changes between horizontal and vertical legs; it never adds to a path's `seconds`. `window`
// keeps only the nodes whose hitbox lies inside it, on the grid anchored at the area bounds.
export interface AirBuildOptions {
  readonly axisChangeSeconds: number;
  readonly tileSize: number;
  readonly window?: Readonly<Rect>;
}

// `bounds` limits every hitbox. `blocked` and `deps` receive hitboxes and edge sweeps and must be
// pure: the build calls them in no promised order, once per candidate hitbox and once per
// candidate pair of hitboxes, whose two edges share the result. Each perch is a landed hitbox the
// caller has already proved supported, at the profile's body size.
export interface AirArea<Id> {
  readonly blocked: (rect: Readonly<Rect>) => boolean;
  readonly bounds: Readonly<Rect>;
  readonly deps: (rect: Readonly<Rect>) => readonly Id[];
  readonly perches: readonly Readonly<Rect>[];
}

export type AirNodeId = number & { readonly __brand: "AirNodeId" };
export type AirEdgeId = number & { readonly __brand: "AirEdgeId" };

export interface AirNode<Id> {
  readonly id: AirNodeId;
  readonly kind: "air" | "perch";
  // The hitbox at this node.
  readonly body: Readonly<Rect>;
  readonly deps: readonly Id[];
}

export interface AirEdge<Id> {
  readonly id: AirEdgeId;
  readonly from: AirNodeId;
  readonly to: AirNodeId;
  readonly kind: "fly" | "land" | "lift";
  // The leg's axis; `land` and `lift` count as vertical.
  readonly axis: "x" | "y";
  readonly seconds: number;
  // The bounding box of both endpoint hitboxes.
  readonly sweep: Readonly<Rect>;
  readonly deps: readonly Id[];
}

// Nodes and edges are indexed by id; `outgoing` lists each node's edge ids in ascending order.
export interface AirMap<Id> {
  readonly edges: readonly AirEdge<Id>[];
  readonly nodes: readonly AirNode<Id>[];
  readonly options: AirBuildOptions;
  readonly outgoing: readonly (readonly AirEdgeId[])[];
  readonly profile: FlightProfile;
}

// `edge` receives the travel seconds from the path start at which the edge departs.
export interface AirMask {
  readonly edge: (id: AirEdgeId, departSeconds: number) => boolean;
  readonly key: string;
  readonly node: (id: AirNodeId) => boolean;
}

// A point goal is met by a node whose hitbox centre lies within `radius` of `point`.
export type AirGoal<Id> =
  | { readonly node: AirNodeId }
  | { readonly point: Point; readonly radius: number }
  | { readonly predicate: (node: AirNode<Id>) => boolean };

// `seconds` is travel time only, without axis-change costs.
export interface AirPath {
  readonly edges: readonly AirEdgeId[];
  readonly nodes: readonly AirNodeId[];
  readonly seconds: number;
}

const finite = (value: number) => Number.isFinite(value);
const positive = (value: number) => Number.isFinite(value) && value > 0;

function union(a: Readonly<Rect>, b: Readonly<Rect>): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    x,
    y,
  };
}

function manhattan(a: Readonly<Rect>, b: Readonly<Rect>): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function centre(rect: Readonly<Rect>): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Finite, with a nonnegative size.
function finiteRect(rect: Readonly<Rect>): boolean {
  return (
    [rect.x, rect.y].every(finite) && [rect.width, rect.height].every((v) => finite(v) && v >= 0)
  );
}

function inside(outer: Readonly<Rect>, rect: Readonly<Rect>): boolean {
  return (
    rect.x >= outer.x &&
    rect.y >= outer.y &&
    rect.x + rect.width <= outer.x + outer.width &&
    rect.y + rect.height <= outer.y + outer.height
  );
}

function validate<Id>(options: AirBuildOptions, profile: FlightProfile, area: AirArea<Id>): void {
  const { body } = profile;
  if (
    !positive(options.tileSize) ||
    !finite(options.axisChangeSeconds) ||
    options.axisChangeSeconds < 0
  ) {
    throw new RangeError(
      "Air map options need a positive tileSize and a nonnegative axisChangeSeconds",
    );
  }
  if (
    !positive(body.width) ||
    !positive(body.height) ||
    !finite(body.offset.x) ||
    !finite(body.offset.y) ||
    !positive(profile.speed) ||
    !positive(profile.cell)
  ) {
    throw new RangeError(
      "Flight profile needs a positive body size, speed and cell and a finite offset",
    );
  }
  const { bounds } = area;
  if (!finiteRect(bounds)) {
    throw new RangeError("Air area bounds must be finite");
  }
  if (options.window !== undefined && !finiteRect(options.window)) {
    throw new RangeError("An air build window must be finite");
  }
  for (const perch of area.perches) {
    if (!inside(bounds, perch) || perch.width !== body.width || perch.height !== body.height) {
      throw new RangeError(
        "Each perch must be a hitbox inside the bounds at the profile's body size",
      );
    }
  }
}

// An edge under construction, whose id changes when its node's land edges are sorted in.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// An unblocked pair of hitboxes; both of its edges share its sweep and deps.
interface Leg<Id> {
  readonly deps: readonly Id[];
  readonly seconds: number;
  readonly sweep: Readonly<Rect>;
}

// A perch's land and lift leg to the cell at index `cell`.
interface Link<Id> {
  readonly cell: number;
  readonly leg: Leg<Id>;
}

const KIND_ORDER = { fly: 0, land: 1, lift: 2 } as const;

// Clear cells every `cell` tiles from the bounds' top-left where the hitbox fits, 4-neighbour
// `fly` edges, and a `perch` node per perch linked by `land` and `lift` to the lowest clear cell
// at or above it in its nearest column with an unblocked sweep. A window keeps only the cells and
// perches whose hitbox lies inside it, which yields the full build's subgraph on those nodes.
// Nodes sort by (y, x, air before perch) and edges by (from, to, kind).
export function buildAirMap<Id>(
  options: AirBuildOptions,
  profile: FlightProfile,
  area: AirArea<Id>,
): AirMap<Id> {
  validate(options, profile, area);
  const { body, speed } = profile;
  const { bounds } = area;
  const { window } = options;
  const kept = (rect: Readonly<Rect>) => window === undefined || inside(window, rect);
  const step = profile.cell * options.tileSize;
  const columns =
    bounds.width >= body.width ? Math.floor((bounds.width - body.width) / step) + 1 : 0;
  const rows =
    bounds.height >= body.height ? Math.floor((bounds.height - body.height) / step) + 1 : 0;
  // Each grid slot's index into `cells`, or -1 where no air node is kept.
  const slots = new Int32Array(rows * columns).fill(-1);
  const cells: Rect[] = [];
  const cellSlot: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const rect = {
        height: body.height,
        width: body.width,
        x: bounds.x + column * step,
        y: bounds.y + row * step,
      };
      if (kept(rect) && !area.blocked(rect)) {
        slots[row * columns + column] = cells.length;
        cells.push(rect);
        cellSlot.push(row * columns + column);
      }
    }
  }
  const seen = new Set<string>();
  const perches: Rect[] = [];
  for (const perch of area.perches) {
    const key = `${perch.x},${perch.y}`;
    if (!seen.has(key) && kept(perch)) {
      seen.add(key);
      perches.push({ ...perch });
    }
  }
  perches.sort((a, b) => a.y - b.y || a.x - b.x);
  // Cells are already in (y, x) order; merge the sorted perches into them.
  const nodes: AirNode<Id>[] = [];
  const cellId = new Int32Array(cells.length);
  // Each node's index into `cells`, or -1 - its index into `perches`.
  const source: number[] = [];
  const add = (rect: Readonly<Rect>, kind: AirNode<Id>["kind"], index: number) => {
    source.push(index);
    nodes.push({ body: rect, deps: area.deps(rect), id: nodes.length as AirNodeId, kind });
  };
  let next = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] as Rect;
    for (
      let perch = perches[next];
      perch !== undefined && (perch.y - cell.y || perch.x - cell.x) < 0;
      perch = perches[next]
    ) {
      add(perch, "perch", -1 - next);
      next += 1;
    }
    cellId[index] = nodes.length;
    add(cell, "air", index);
  }
  for (; next < perches.length; next += 1) {
    add(perches[next] as Rect, "perch", -1 - next);
  }
  const perchId = new Int32Array(perches.length);
  source.forEach((index, id) => {
    if (index < 0) {
      perchId[-1 - index] = id;
    }
  });
  const leg = (a: Readonly<Rect>, b: Readonly<Rect>): Leg<Id> | undefined => {
    const sweep = union(a, b);
    return area.blocked(sweep)
      ? undefined
      : { deps: area.deps(sweep), seconds: manhattan(a, b) / speed, sweep };
  };
  // The fly legs to the next cell right and below, by cell index.
  const rightLeg: (Leg<Id> | undefined)[] = [];
  const belowLeg: (Leg<Id> | undefined)[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] as Rect;
    const slot = cellSlot[index] as number;
    const right = slot % columns < columns - 1 ? (slots[slot + 1] as number) : -1;
    const below = slot + columns < slots.length ? (slots[slot + columns] as number) : -1;
    rightLeg.push(right >= 0 ? leg(cell, cells[right] as Rect) : undefined);
    belowLeg.push(below >= 0 ? leg(cell, cells[below] as Rect) : undefined);
  }
  // Each perch's link to its cell, and the perches linked to each cell.
  const links: (Link<Id> | undefined)[] = [];
  const landings = new Map<number, number[]>();
  for (const [index, perch] of perches.entries()) {
    const column = Math.min(columns - 1, Math.max(0, Math.round((perch.x - bounds.x) / step)));
    const lowest = Math.min(rows - 1, Math.floor((perch.y - bounds.y) / step));
    let link: Link<Id> | undefined;
    for (let row = column >= 0 ? lowest : -1; link === undefined && row >= 0; row -= 1) {
      const above = slots[row * columns + column] as number;
      const found = above >= 0 ? leg(cells[above] as Rect, perch) : undefined;
      link = found && { cell: above, leg: found };
    }
    links.push(link);
    if (link !== undefined) {
      landings.set(link.cell, [...(landings.get(link.cell) ?? []), index]);
    }
  }
  // Edges in (from, to, kind) order. A cell's fly edges run up, left, right and down, which is
  // ascending id order; its land edges, if any, are sorted in.
  const edges: Mutable<AirEdge<Id>>[] = [];
  const emit = (from: number, to: number, kind: AirEdge<Id>["kind"], axis: "x" | "y", l: Leg<Id>) =>
    edges.push({
      axis,
      deps: l.deps,
      from: from as AirNodeId,
      id: edges.length as AirEdgeId,
      kind,
      seconds: l.seconds,
      sweep: l.sweep,
      to: to as AirNodeId,
    });
  const outgoing = source.map((index, id) => {
    const start = edges.length;
    if (index < 0) {
      const link = links[-1 - index];
      if (link !== undefined) {
        emit(id, cellId[link.cell] as number, "lift", "y", link.leg);
      }
      return start < edges.length ? [start as AirEdgeId] : [];
    }
    const slot = cellSlot[index] as number;
    const up = slot >= columns ? (slots[slot - columns] as number) : -1;
    const left = slot % columns > 0 ? (slots[slot - 1] as number) : -1;
    const right = rightLeg[index];
    const below = belowLeg[index];
    const upLeg = up >= 0 ? belowLeg[up] : undefined;
    const leftLeg = left >= 0 ? rightLeg[left] : undefined;
    if (upLeg !== undefined) {
      emit(id, cellId[up] as number, "fly", "y", upLeg);
    }
    if (leftLeg !== undefined) {
      emit(id, cellId[left] as number, "fly", "x", leftLeg);
    }
    if (right !== undefined) {
      emit(id, cellId[slots[slot + 1] as number] as number, "fly", "x", right);
    }
    if (below !== undefined) {
      emit(id, cellId[slots[slot + columns] as number] as number, "fly", "y", below);
    }
    const landed = landings.get(index);
    if (landed !== undefined) {
      for (const perch of landed) {
        emit(id, perchId[perch] as number, "land", "y", (links[perch] as Link<Id>).leg);
      }
      const sorted = edges
        .slice(start)
        .sort((a, b) => a.to - b.to || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      sorted.forEach((edge, offset) => {
        edge.id = (start + offset) as AirEdgeId;
        edges[start + offset] = edge;
      });
    }
    const ids: AirEdgeId[] = [];
    for (let edge = start; edge < edges.length; edge += 1) {
      ids.push(edge as AirEdgeId);
    }
    return ids;
  });
  return {
    edges,
    nodes,
    options: { ...options, ...(window && { window: { ...window } }) },
    outgoing,
    profile,
  };
}

// The node nearest `body` by top-left Manhattan distance among nodes whose hitbox overlaps it,
// ties to the lower id.
export function locateAir<Id>(map: AirMap<Id>, body: Readonly<Rect>): AirNodeId | undefined {
  let best: AirNode<Id> | undefined;
  let bestDistance = Infinity;
  for (const node of map.nodes) {
    const distance = manhattan(node.body, body);
    if (rectsOverlap(node.body, body) && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best?.id;
}

interface SearchEntry {
  readonly axis: 0 | 1 | 2;
  readonly cost: number;
  readonly node: AirNodeId;
  readonly priority: number;
  readonly seconds: number;
}

function before(a: SearchEntry, b: SearchEntry): boolean {
  return a.priority !== b.priority
    ? a.priority < b.priority
    : a.node !== b.node
      ? a.node < b.node
      : a.axis < b.axis;
}

// A binary min-heap ordered by priority, then node id, then incoming axis.
class Heap {
  readonly #items: SearchEntry[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(entry: SearchEntry): void {
    const items = this.#items;
    items.push(entry);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(entry, items[parent] as SearchEntry)) {
        break;
      }
      items[index] = items[parent] as SearchEntry;
      index = parent;
    }
    items[index] = entry;
  }

  pop(): SearchEntry | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) {
      return top;
    }
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let child = left;
      if (right < items.length && before(items[right] as SearchEntry, items[left] as SearchEntry)) {
        child = right;
      }
      if (left >= items.length || !before(items[child] as SearchEntry, last)) {
        break;
      }
      items[index] = items[child] as SearchEntry;
      index = child;
    }
    items[index] = last;
    return top;
  }
}

interface SearchResult {
  readonly found?: SearchEntry;
  readonly parents: Map<number, { readonly edge: AirEdgeId; readonly state: number }>;
  readonly settled: Map<number, SearchEntry>;
}

const AXES = { x: 1, y: 2 } as const;
const stateKey = (node: AirNodeId, axis: number) => node * 3 + axis;

// Best-first search over (node, incoming axis) states, departing `from` at `startSeconds` of
// travel. Cost is travel seconds plus the axis-change cost; `heuristic` must not overestimate the
// remaining travel seconds.
function search<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
  startSeconds: number,
  penalty: number,
  done: (node: AirNode<Id>) => boolean,
  heuristic: (node: AirNode<Id>) => number,
): SearchResult {
  const parents = new Map<number, { readonly edge: AirEdgeId; readonly state: number }>();
  const settled = new Map<number, SearchEntry>();
  const best = new Map<number, number>();
  const start = map.nodes[from];
  if (start === undefined || !mask.node(from)) {
    return { parents, settled };
  }
  const heap = new Heap();
  heap.push({ axis: 0, cost: 0, node: from, priority: heuristic(start), seconds: startSeconds });
  best.set(stateKey(from, 0), 0);
  for (let entry = heap.pop(); entry !== undefined; entry = heap.pop()) {
    const key = stateKey(entry.node, entry.axis);
    if (settled.has(key)) {
      continue;
    }
    settled.set(key, entry);
    const node = map.nodes[entry.node] as AirNode<Id>;
    if (done(node)) {
      return { found: entry, parents, settled };
    }
    for (const edgeId of map.outgoing[entry.node] ?? []) {
      const edge = map.edges[edgeId] as AirEdge<Id>;
      const axis = AXES[edge.axis];
      const next = stateKey(edge.to, axis);
      if (settled.has(next) || !mask.node(edge.to) || !mask.edge(edgeId, entry.seconds)) {
        continue;
      }
      const cost =
        entry.cost + edge.seconds + (entry.axis !== 0 && entry.axis !== axis ? penalty : 0);
      if (cost < (best.get(next) ?? Infinity)) {
        best.set(next, cost);
        parents.set(next, { edge: edgeId, state: key });
        const target = map.nodes[edge.to] as AirNode<Id>;
        heap.push({
          axis,
          cost,
          node: edge.to,
          priority: cost + heuristic(target),
          seconds: entry.seconds + edge.seconds,
        });
      }
    }
  }
  return { parents, settled };
}

function goalTest<Id>(goal: AirGoal<Id>): (node: AirNode<Id>) => boolean {
  if ("node" in goal) {
    return (node) => node.id === goal.node;
  }
  if ("point" in goal) {
    return (node) => {
      const c = centre(node.body);
      return Math.hypot(c.x - goal.point.x, c.y - goal.point.y) <= goal.radius;
    };
  }
  return goal.predicate;
}

function goalHeuristic<Id>(map: AirMap<Id>, goal: AirGoal<Id>): (node: AirNode<Id>) => number {
  const { speed } = map.profile;
  if ("node" in goal) {
    const target = map.nodes[goal.node];
    return target === undefined ? () => 0 : (node) => manhattan(node.body, target.body) / speed;
  }
  if ("point" in goal) {
    return (node) => {
      const c = centre(node.body);
      return Math.max(0, Math.hypot(c.x - goal.point.x, c.y - goal.point.y) - goal.radius) / speed;
    };
  }
  return () => 0;
}

// The least-cost path from `from` to the first node meeting `goal`, through nodes and edges the
// mask enables, or undefined. Equal-cost choices go to the lower node id.
export function airPath<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
  goal: AirGoal<Id>,
): AirPath | undefined {
  const { found, parents } = search(
    map,
    mask,
    from,
    0,
    map.options.axisChangeSeconds,
    goalTest(goal),
    goalHeuristic(map, goal),
  );
  if (found === undefined) {
    return undefined;
  }
  const nodes: AirNodeId[] = [found.node];
  const edges: AirEdgeId[] = [];
  for (let parent = parents.get(stateKey(found.node, found.axis)); parent !== undefined;) {
    const edge = map.edges[parent.edge] as AirEdge<Id>;
    edges.push(edge.id);
    nodes.push(edge.from);
    parent = parents.get(parent.state);
  }
  return { edges: edges.reverse(), nodes: nodes.reverse(), seconds: found.seconds };
}

// Every node reachable from `from` through enabled nodes and edges, with each edge's departure
// at the earliest travel time; empty when `from` is disabled.
export function reachableAir<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
): ReadonlySet<AirNodeId> {
  const { settled } = search(
    map,
    mask,
    from,
    0,
    0,
    () => false,
    () => 0,
  );
  return new Set([...settled.values()].map((entry) => entry.node).sort((a, b) => a - b));
}

// The reachable node whose hitbox centre is nearest `toward`, ties to the lower id.
export function nearestReachableAir<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
  toward: Point,
): AirNodeId | undefined {
  let best: AirNodeId | undefined;
  let bestDistance = Infinity;
  for (const id of reachableAir(map, mask, from)) {
    const c = centre((map.nodes[id] as AirNode<Id>).body);
    const distance = Math.hypot(c.x - toward.x, c.y - toward.y);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

// The nodes reachable from `from`, other than `exits`, from which no exit is reachable when
// departing at the earliest travel time that reaches them, in id order. Masks see departure
// seconds measured from `from`. It runs one search per reachable node.
export function sinksAir<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
  exits: readonly AirNodeId[],
): readonly AirNodeId[] {
  const targets = new Set(exits);
  const first = new Map<AirNodeId, number>();
  const { settled } = search(
    map,
    mask,
    from,
    0,
    0,
    () => false,
    () => 0,
  );
  for (const entry of settled.values()) {
    if (!first.has(entry.node)) {
      first.set(entry.node, entry.seconds);
    }
  }
  const exit = (node: AirNode<Id>) => targets.has(node.id);
  return [...first.keys()]
    .sort((a, b) => a - b)
    .filter(
      (id) =>
        !targets.has(id) && !search(map, mask, id, first.get(id) ?? 0, 0, exit, () => 0).found,
    );
}

const rectText = (rect: Readonly<Rect>) => `${rect.x},${rect.y},${rect.width},${rect.height}`;

// The canonical form, one line per entry joined by "\n", numbers in JavaScript's shortest
// round-trip form and deps as depKey values joined by "," in the area's order:
//   air-map 1
//   options <tileSize> <axisChangeSeconds>
//   window <x>,<y>,<width>,<height>                           (only when built with a window)
//   profile <width>,<height>,<offset x>,<offset y> <speed> <cell>
//   node <id> <kind> <x>,<y>,<width>,<height> <deps>          (in id order)
//   edge <id> <from> <to> <kind> <axis> <seconds> <sweep> <deps>   (in id order)
export function airMapCanonical<Id>(depKey: (id: Id) => string, map: AirMap<Id>): string {
  const deps = (ids: readonly Id[]) => ids.map(depKey).join(",");
  const { body, cell, speed } = map.profile;
  const lines = [
    "air-map 1",
    `options ${map.options.tileSize} ${map.options.axisChangeSeconds}`,
    ...(map.options.window === undefined ? [] : [`window ${rectText(map.options.window)}`]),
    `profile ${body.width},${body.height},${body.offset.x},${body.offset.y} ${speed} ${cell}`,
    ...map.nodes.map(
      (node) => `node ${node.id} ${node.kind} ${rectText(node.body)} ${deps(node.deps)}`,
    ),
    ...map.edges.map(
      (edge) =>
        `edge ${edge.id} ${edge.from} ${edge.to} ${edge.kind} ${edge.axis} ${edge.seconds} ` +
        `${rectText(edge.sweep)} ${deps(edge.deps)}`,
    ),
  ];
  return lines.join("\n");
}

// FNV-1a 64 of airMapCanonical, as 16 lowercase hex digits.
export function airMapHash<Id>(depKey: (id: Id) => string, map: AirMap<Id>): string {
  return fnv1a64(airMapCanonical(depKey, map));
}
