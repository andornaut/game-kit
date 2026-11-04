import { type Point, type Rect, rectsOverlap } from "../rect.ts";

// A flyer's hitbox size and its offset from the actor position, in pixels; `speed` is
// pixels/second and `cell` is the grid step in tiles.
export interface FlightProfile {
  readonly body: Readonly<Pick<Rect, "height" | "width">> & { readonly offset: Point };
  readonly speed: number;
  readonly cell: number;
}

// `tileSize` is pixels per tile. `axisChangeSeconds` is the search cost added where a route
// changes between horizontal and vertical legs; it never adds to a path's `seconds`.
export interface AirBuildOptions {
  readonly axisChangeSeconds: number;
  readonly tileSize: number;
}

// `bounds` limits every hitbox. `blocked` and `deps` receive hitboxes and edge sweeps. Each
// perch is a landed hitbox the caller has already proved supported, at the profile's body size.
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

function sameRect(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

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
  if (
    ![bounds.x, bounds.y].every(finite) ||
    ![bounds.width, bounds.height].every((v) => finite(v) && v >= 0)
  ) {
    throw new RangeError("Air area bounds must be finite");
  }
  for (const perch of area.perches) {
    const inside =
      perch.x >= bounds.x &&
      perch.y >= bounds.y &&
      perch.x + perch.width <= bounds.x + bounds.width &&
      perch.y + perch.height <= bounds.y + bounds.height;
    if (!inside || perch.width !== body.width || perch.height !== body.height) {
      throw new RangeError(
        "Each perch must be a hitbox inside the bounds at the profile's body size",
      );
    }
  }
}

interface Draft<Id> {
  readonly kind: "air" | "perch";
  readonly body: Readonly<Rect>;
  readonly deps: readonly Id[];
  readonly column?: number;
  readonly row?: number;
}

interface DraftEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: "fly" | "land" | "lift";
  readonly axis: "x" | "y";
}

const KIND_ORDER = { air: 0, fly: 0, land: 1, lift: 2, perch: 1 } as const;

// Clear cells every `cell` tiles from the bounds' top-left where the hitbox fits, 4-neighbour
// `fly` edges, and a `perch` node per perch linked by `land` and `lift` to the lowest clear cell
// at or above it in its nearest column with an unblocked sweep. Nodes sort by (y, x, kind) and
// edges by (from, to, kind).
export function buildAirMap<Id>(
  options: AirBuildOptions,
  profile: FlightProfile,
  area: AirArea<Id>,
): AirMap<Id> {
  validate(options, profile, area);
  const { body, speed } = profile;
  const { bounds } = area;
  const step = profile.cell * options.tileSize;
  const columns =
    bounds.width >= body.width ? Math.floor((bounds.width - body.width) / step) + 1 : 0;
  const rows =
    bounds.height >= body.height ? Math.floor((bounds.height - body.height) / step) + 1 : 0;
  const drafts: Draft<Id>[] = [];
  const cellDraft = new Map<number, number>();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const rect = {
        height: body.height,
        width: body.width,
        x: bounds.x + column * step,
        y: bounds.y + row * step,
      };
      if (!area.blocked(rect)) {
        cellDraft.set(row * columns + column, drafts.length);
        drafts.push({ body: rect, column, deps: area.deps(rect), kind: "air", row });
      }
    }
  }
  const edges: DraftEdge[] = [];
  const link = (from: number, to: number, kind: DraftEdge["kind"], axis: DraftEdge["axis"]) => {
    const a = drafts[from];
    const b = drafts[to];
    if (a !== undefined && b !== undefined && !area.blocked(union(a.body, b.body))) {
      edges.push({ axis, from, kind, to });
    }
  };
  for (const [index, draft] of drafts.entries()) {
    const { column = 0, row = 0 } = draft;
    const neighbours = [
      [column - 1, row, "x"],
      [column + 1, row, "x"],
      [column, row - 1, "y"],
      [column, row + 1, "y"],
    ] as const;
    for (const [c, r, axis] of neighbours) {
      const to =
        c >= 0 && c < columns && r >= 0 && r < rows ? cellDraft.get(r * columns + c) : undefined;
      if (to !== undefined) {
        link(index, to, "fly", axis);
      }
    }
  }
  const unique = area.perches.filter(
    (perch, index) => area.perches.findIndex((p) => sameRect(p, perch)) === index,
  );
  for (const perch of unique) {
    const index = drafts.length;
    drafts.push({ body: { ...perch }, deps: area.deps(perch), kind: "perch" });
    const column = Math.min(columns - 1, Math.max(0, Math.round((perch.x - bounds.x) / step)));
    const lowest = Math.min(rows - 1, Math.floor((perch.y - bounds.y) / step));
    for (let row = lowest; row >= 0; row -= 1) {
      const above = cellDraft.get(row * columns + column);
      const cell = above === undefined ? undefined : drafts[above];
      if (above !== undefined && cell !== undefined && !area.blocked(union(cell.body, perch))) {
        edges.push({ axis: "y", from: above, kind: "land", to: index });
        edges.push({ axis: "y", from: index, kind: "lift", to: above });
        break;
      }
    }
  }
  const order = drafts
    .map((_, index) => index)
    .sort((a, b) => {
      const p = drafts[a] as Draft<Id>;
      const q = drafts[b] as Draft<Id>;
      return p.body.y - q.body.y || p.body.x - q.body.x || KIND_ORDER[p.kind] - KIND_ORDER[q.kind];
    });
  const idOf = new Array<number>(drafts.length);
  order.forEach((draft, id) => {
    idOf[draft] = id;
  });
  const nodes: AirNode<Id>[] = order.map((draft, id) => {
    const { body: rect, deps, kind } = drafts[draft] as Draft<Id>;
    return { body: rect, deps, id: id as AirNodeId, kind };
  });
  const sorted = edges
    .map((edge) => ({ ...edge, from: idOf[edge.from] as number, to: idOf[edge.to] as number }))
    .sort((a, b) => a.from - b.from || a.to - b.to || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const outgoing: AirEdgeId[][] = nodes.map(() => []);
  const built: AirEdge<Id>[] = sorted.map((edge, id) => {
    const from = nodes[edge.from] as AirNode<Id>;
    const to = nodes[edge.to] as AirNode<Id>;
    const sweep = union(from.body, to.body);
    outgoing[edge.from]?.push(id as AirEdgeId);
    return {
      axis: edge.axis,
      deps: area.deps(sweep),
      from: from.id,
      id: id as AirEdgeId,
      kind: edge.kind,
      seconds: manhattan(from.body, to.body) / speed,
      sweep,
      to: to.id,
    };
  });
  return { edges: built, nodes, options: { ...options }, outgoing, profile };
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

// Best-first search over (node, incoming axis) states. Cost is travel seconds plus the
// axis-change cost; `heuristic` must not overestimate the remaining travel seconds.
function search<Id>(
  map: AirMap<Id>,
  mask: AirMask,
  from: AirNodeId,
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
  heap.push({ axis: 0, cost: 0, node: from, priority: heuristic(start), seconds: 0 });
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

// FNV-1a 64 over the UTF-8 bytes of text, as 16 lowercase hex digits. The 64-bit state is kept
// as two 32-bit halves; the prime is 2^40 + 0x1b3.
function fnv1a64(text: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  const mix = (byte: number) => {
    lo = (lo ^ byte) >>> 0;
    const low = lo * 0x1b3;
    const carry = Math.floor(low / 0x100000000);
    hi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) >>> 0;
    lo = low >>> 0;
  };
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) {
      mix(code);
    } else if (code < 0x800) {
      mix(0xc0 | (code >> 6));
      mix(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    } else {
      mix(0xf0 | (code >> 18));
      mix(0x80 | ((code >> 12) & 0x3f));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

const rectText = (rect: Readonly<Rect>) => `${rect.x},${rect.y},${rect.width},${rect.height}`;

// The canonical form, one line per entry joined by "\n", numbers in JavaScript's shortest
// round-trip form and deps as depKey values joined by "," in the area's order:
//   air-map 1
//   options <tileSize> <axisChangeSeconds>
//   profile <width>,<height>,<offset x>,<offset y> <speed> <cell>
//   node <id> <kind> <x>,<y>,<width>,<height> <deps>          (in id order)
//   edge <id> <from> <to> <kind> <axis> <seconds> <sweep> <deps>   (in id order)
export function airMapCanonical<Id>(depKey: (id: Id) => string, map: AirMap<Id>): string {
  const deps = (ids: readonly Id[]) => ids.map(depKey).join(",");
  const { body, cell, speed } = map.profile;
  const lines = [
    "air-map 1",
    `options ${map.options.tileSize} ${map.options.axisChangeSeconds}`,
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
