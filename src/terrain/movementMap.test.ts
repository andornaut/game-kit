import { describe, expect, it } from "vitest";

import type { Point, Rect } from "../rect.ts";
import {
  buildMovementMap,
  DEFAULT_JUMP_SCRIPTS,
  type EdgeId,
  locate,
  type MapArea,
  type MapBuildOptions,
  mapCanonical,
  type MapEdgeKind,
  type MapGoal,
  mapHash,
  type MapMask,
  type MapNode,
  type MapPath,
  type MapStep,
  type MovementMap,
  type MovementProfile,
  nearestReachable,
  type NodeId,
  type NodeRef,
  pathOrNearest,
  pathTo,
  reachableSet,
  sinks,
} from "./movementMap.ts";
import { stepTraversal, type TraversalCollider, type TraversalState } from "./traversal.ts";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  height,
  width,
  x,
  y,
});
const solid = (id: string, r: Rect): TraversalCollider<string> => ({
  after: r,
  before: r,
  kind: "solid",
  supportId: id,
});
const ledge = (id: string, r: Rect): TraversalCollider<string> => ({
  after: r,
  before: r,
  kind: "ledge",
  supportId: id,
});
const options: MapBuildOptions<string> = {
  dtSeconds: 0.1,
  epsilon: 1e-7,
  horizonSteps: 40,
  launchStride: 4,
  maxCollisionSteps: 32,
};
const profile: MovementProfile = {
  body: { height: 2, offset: { x: 0, y: 0 }, width: 2 },
  gravity: 20,
  jumpSpeed: 10,
  maxFallSpeed: 20,
  walkSpeed: 10,
};
const climber: MovementProfile = { ...profile, climb: { height: 8, speed: 4 } };
const hazardsIn =
  (...hazards: Rect[]) =>
  (sweep: Readonly<Rect>) =>
    hazards.some(
      (h) =>
        sweep.x < h.x + h.width &&
        h.x < sweep.x + sweep.width &&
        sweep.y < h.y + h.height &&
        h.y < sweep.y + sweep.height,
    );
const area = (
  colliders: TraversalCollider<string>[],
  blocked: (sweep: Readonly<Rect>) => boolean = () => false,
): MapArea<string> => ({
  blocked,
  bounds: rect(-20, -30, 100, 60),
  colliders,
  deps: () => [],
});
const open: MapMask = { edge: () => true, key: "open", node: () => true };
const withoutKind = (map: MovementMap<string>, kind: MapEdgeKind): MapMask => ({
  edge: (id) => map.edges[id]!.kind !== kind,
  key: `no-${kind}`,
  node: () => true,
});
// The node whose span holds hitbox-left x on support top y.
const nodeAt = (map: MovementMap<string>, x: number, y: number): NodeId => {
  const found = locate(map, rect(x, y - 2, 2, 2));
  if (!found) {
    throw new Error(`No node at ${x},${y}`);
  }
  return found.node;
};

const layouts = {
  ceilings: [
    solid("floor", rect(0, 10, 40, 5)),
    solid("high", rect(10, 7, 6, 1)),
    solid("low", rect(25, 7.5, 4, 1)),
  ],
  climb: [solid("floor", rect(0, 10, 30, 5)), ledge("shelf", rect(10, 4, 6, 1))],
  drop: [solid("upper", rect(0, 10, 10, 5)), solid("lower", rect(10, 16, 10, 5))],
  flat: [solid("floor", rect(0, 10, 40, 5))],
  gap: [solid("a", rect(0, 10, 10, 5)), solid("b", rect(15, 10, 20, 5))],
  wall: [
    solid("a", rect(7, 10, 3, 5)),
    solid("wall", rect(10, 9.5, 2, 20)),
    solid("b", rect(19, 10, 10, 5)),
  ],
  wide: [solid("a", rect(0, 10, 10, 5)), solid("b", rect(30, 10, 10, 5))],
};

describe("movement map spans", () => {
  it.each([
    ["flat floor", layouts.flat, [[10, 0, 38]]],
    [
      "ceiling headroom split",
      layouts.ceilings,
      [
        [7, 10, 14],
        [7.5, 25, 27],
        [10, 0, 8],
        [10, 8, 16],
        [10, 16, 23],
        [10, 29, 38],
      ],
    ],
    [
      "wall top",
      layouts.wall,
      [
        [9.5, 10, 10],
        [10, 7, 8],
        [10, 19, 27],
      ],
    ],
  ] as const)("builds maximal spans: %s", (_, colliders, expected) => {
    const map = buildMovementMap(options, profile, area([...colliders]));
    expect(map.nodes.map((n) => [n.y, n.left, n.right])).toEqual(expected);
    expect(map.nodes.map((n) => n.id)).toEqual(map.nodes.map((_, i) => i));
    expect(map.nodes.every((n) => n.kind === "static")).toBe(true);
  });

  it("joins touching spans with walk edges and never walks across a ceiling too low to stand", () => {
    const map = buildMovementMap(options, profile, area([...layouts.ceilings]));
    const [left, under, right, far] = [0, 9, 17, 30].map((x) => nodeAt(map, x, 10));
    const walks = map.edges
      .filter((e) => e.kind === "walk")
      .map((e) => [e.from, e.to, e.commands.length]);
    expect(walks).toEqual([
      [left, under, 1],
      [under, left, 1],
      [under, right, 1],
      [right, under, 1],
    ]);
    expect(reachableSet(map, open, { node: left!, x: 0 }).has(far!)).toBe(false);
  });

  it("splits a span at a blocked sweep and takes node kind and deps from the area", () => {
    const map = buildMovementMap(options, profile, {
      ...area([...layouts.flat], hazardsIn(rect(19.5, 9, 1, 1))),
      deps: (sweep) => (sweep.x < 10 ? ["left"] : []),
      kind: (supportId, sweep) => `${supportId}@${sweep.x}`,
    });
    expect(map.nodes.map((n) => [n.left, n.right, n.kind, n.deps])).toEqual([
      [0, 17, "floor@0", ["left"]],
      [21, 38, "floor@21", []],
    ]);
    expect(map.edges.some((e) => e.kind === "walk")).toBe(false);
  });
});

describe("movement map edges and paths", () => {
  it.each([
    ["gap needing a jump", layouts.gap, profile, [8, 10], [15, 10], ["jump"]],
    ["unjumpable gap", layouts.wide, profile, [8, 10], [30, 10], undefined],
    ["drop to lower ledge", layouts.drop, profile, [0, 10], [12, 16], ["drop"]],
    ["no way back up from a lower ledge", layouts.drop, profile, [12, 16], [0, 10], undefined],
    ["wall top", layouts.wall, profile, [8, 10], [19, 10], ["wall-top"]],
    ["climb without a climb profile", layouts.climb, profile, [0, 10], [10, 4], undefined],
    ["climb with a climb profile", layouts.climb, climber, [0, 10], [10, 4], ["climb"]],
  ] as const)("%s", (_, colliders, mover, [fx, fy], [tx, ty], kinds) => {
    const map = buildMovementMap(options, mover, area([...colliders]));
    const from = { node: nodeAt(map, fx, fy), x: fx };
    const path = pathTo(map, open, from, { node: nodeAt(map, tx, ty) });
    expect(path?.edges.map((id) => map.edges[id]!.kind)).toEqual(kinds);
    if (path) {
      expect(path.nodes[0]).toBe(from.node);
      expect(path.nodes).toHaveLength(path.edges.length + 1);
      expect(path.seconds).toBeGreaterThan(0);
    }
  });

  it("replays every kernel witness from its launch onto its landing span", () => {
    const map = buildMovementMap(options, profile, area([...layouts.wall]));
    const geometry = { colliders: [...layouts.wall], complete: true };
    for (const edge of map.edges) {
      const from = map.nodes[edge.from]!;
      let state: TraversalState<string> = {
        fallFromY: from.y,
        grounded: true,
        supportId: from.supportId,
        vy: 0,
        x: edge.launch.left,
        y: from.y - 2,
      };
      edge.commands.forEach((command, tick) => {
        const result = stepTraversal(
          {
            body: profile.body,
            bounds: rect(-20, -30, 100, 60),
            dtSeconds: 0.1,
            epsilon: 1e-7,
            maxCollisionSteps: 32,
            maxDrop: 60,
            profile,
            safe: () => true,
            sampleColliders: () => geometry,
          },
          { ...command, timeSeconds: tick * 0.1 },
          state,
        );
        expect(result.status).toBe("ok");
        state = result.state;
      });
      const to = map.nodes[edge.to]!;
      expect(state.grounded).toBe(true);
      expect(state.y + 2).toBeCloseTo(to.y);
      expect(state.x).toBeCloseTo(edge.land.left);
      expect(edge.seconds).toBeCloseTo(edge.commands.length * 0.1);
    }
  });

  it("fails the wall-top route without wall-top edges", () => {
    const map = buildMovementMap(options, profile, area([...layouts.wall]));
    const from = { node: nodeAt(map, 8, 10), x: 8 };
    const goal = { node: nodeAt(map, 19, 10) };
    expect(pathTo(map, open, from, goal)).toBeDefined();
    expect(pathTo(map, withoutKind(map, "wall-top"), from, goal)).toBeUndefined();
  });

  it("rejects a jump whose landing is blocked", () => {
    const clear = buildMovementMap(options, profile, area([...layouts.gap]));
    const hazard = buildMovementMap(
      options,
      profile,
      area([...layouts.gap], hazardsIn(rect(15, 7, 7, 3))),
    );
    expect(clear.edges.some((e) => e.kind === "jump" && e.from === 0)).toBe(true);
    expect(hazard.nodes.map((n) => [n.left, n.right])).toEqual([
      [0, 8],
      [22, 33],
    ]);
    expect(hazard.edges.filter((e) => e.from === 0)).toEqual([]);
  });

  it("rejects a drop into a blocked volume", () => {
    const map = buildMovementMap(
      options,
      profile,
      area([...layouts.drop], hazardsIn(rect(10, 12, 10, 2))),
    );
    expect(map.edges.filter((e) => e.kind === "drop")).toEqual([]);
  });

  it("uses the caller's jump scripts and step", () => {
    let calls = 0;
    const map = buildMovementMap(
      {
        ...options,
        jumps: [{ hold: { jump: true, move: 1 } }],
        step: (context, input, state) => {
          calls++;
          return stepTraversal(context, input, state);
        },
      },
      profile,
      area([...layouts.gap]),
    );
    expect(calls).toBe(map.work.steps);
    expect(map.options.jumps).toEqual([{ hold: { jump: true, move: 1 } }]);
    expect(pathTo(map, open, { node: 0 as NodeId, x: 0 }, { node: 1 as NodeId })).toBeDefined();
    expect(pathTo(map, open, { node: 1 as NodeId, x: 15 }, { node: 0 as NodeId })).toBeUndefined();
    const hop = buildMovementMap(
      { ...options, jumps: [{ hold: { jump: true, move: 1 }, jumpSpeed: 4 }] },
      profile,
      area([...layouts.gap]),
    );
    expect(hop.edges.filter((e) => e.kind === "jump")).toEqual([]);
  });

  it("rejects invalid options and moving colliders", () => {
    expect(() =>
      buildMovementMap({ ...options, launchStride: 0 }, profile, area([...layouts.flat])),
    ).toThrow(RangeError);
    expect(() =>
      buildMovementMap(
        { ...options, jumps: [{ hold: { jump: false, move: 1 } }] },
        profile,
        area([...layouts.flat]),
      ),
    ).toThrow(RangeError);
    const lift = { ...solid("lift", rect(0, 10, 4, 1)), after: rect(0, 9, 4, 1) };
    expect(() => buildMovementMap(options, profile, area([lift]))).toThrow(RangeError);
  });
});

describe("movement map queries", () => {
  it("masks nodes and edges, passing each edge its departure seconds", () => {
    const map = buildMovementMap(options, profile, area([...layouts.gap]));
    const from = { node: 0 as NodeId, x: 0 };
    const goal = { node: 1 as NodeId };
    const departures: [EdgeId, number][] = [];
    const path = pathTo(
      map,
      {
        edge: (id, seconds) => {
          departures.push([id, seconds]);
          return true;
        },
        key: "spy",
        node: () => true,
      },
      from,
      goal,
    );
    const used = map.edges[path!.edges[0]!]!;
    // Walking from x 0 to the launch costs distance / walkSpeed before departure.
    expect(departures.find(([id]) => id === used.id)![1]).toBeCloseTo(used.launch.left / 10);
    expect(path!.seconds).toBeCloseTo(used.launch.left / 10 + used.seconds);
    const noB: MapMask = { edge: () => true, key: "no-b", node: (id) => id !== 1 };
    expect(pathTo(map, noB, from, goal)).toBeUndefined();
    const noEdges: MapMask = { edge: () => false, key: "none", node: () => true };
    expect(pathTo(map, noEdges, from, goal)).toBeUndefined();
    expect(reachableSet(map, noB, from)).toEqual(new Set([0]));
    const noStart: MapMask = { edge: () => true, key: "no-a", node: (id) => id !== 0 };
    expect(reachableSet(map, noStart, from).size).toBe(0);
  });

  it("finds sinks: nodes reached from the start that cannot reach an exit", () => {
    const map = buildMovementMap(options, profile, area([...layouts.drop]));
    const upper = nodeAt(map, 0, 10);
    const lower = nodeAt(map, 12, 16);
    const from = { node: upper, x: 0 };
    expect(sinks(map, open, from, [upper])).toEqual([lower]);
    expect(sinks(map, open, from, [lower])).toEqual([]);
  });

  it("returns the nearest reachable position for an unreachable goal", () => {
    const map = buildMovementMap(options, profile, area([...layouts.wide]));
    const from = { node: 0 as NodeId, x: 0 };
    const point = { x: 35, y: 10 };
    expect(pathTo(map, open, from, { point, radius: 1 })).toBeUndefined();
    expect(nearestReachable(map, open, from, point)).toEqual({ node: 0, x: 8 });
    expect(pathTo(map, open, from, { predicate: (n) => n.left === 30 })).toBeUndefined();
  });

  it("locates a body on its span and rejects unknown starts", () => {
    const map = buildMovementMap(options, profile, area([...layouts.gap]));
    expect(locate(map, rect(16, 8, 2, 2))).toEqual({ node: 1, x: 16 });
    expect(locate(map, rect(11, 8, 2, 2))).toBeUndefined();
    expect(() => reachableSet(map, open, { node: 9 as NodeId, x: 0 })).toThrow(RangeError);
  });
});

describe("movement map determinism and work", () => {
  it("hashes two builds equally, matching the golden value", () => {
    const first = buildMovementMap(options, profile, area([...layouts.wall]));
    const second = buildMovementMap(options, profile, area([...layouts.wall]));
    expect(mapCanonical(String, first)).toBe(mapCanonical(String, second));
    expect(mapHash(String, first)).toBe(mapHash(String, second));
    expect(mapCanonical(String, first).split("\n").slice(0, 4)).toEqual([
      "movement-map 1",
      "options 0.1 1e-7 40 4 32 /L/-/-,/S/-/-,/R/-/-,/L/S/-,/R/S/-",
      "profile 2,2,0,0 10 20 10 20 -,-",
      "node 0 static 9.5 10,10 wall ",
    ]);
    expect(mapHash(String, first)).toBe("6aa714a4c575977a");
  });

  it("hashes maps that differ only in profile differently", () => {
    const empty = { ...buildMovementMap(options, profile, area([])), edges: [], nodes: [] };
    expect(mapHash(String, empty)).toMatch(/^[0-9a-f]{16}$/);
    expect(mapHash(String, empty)).not.toBe(mapHash(String, { ...empty, profile: climber }));
  });

  it("bounds work in kernel steps and prunes launches with no target in reach", () => {
    const flat = buildMovementMap(options, profile, area([...layouts.flat]));
    expect(flat.edges).toEqual([]);
    expect(flat.work.steps).toBe(0);
    const map = buildMovementMap(options, profile, area([...layouts.wall]));
    const scripts = DEFAULT_JUMP_SCRIPTS.length;
    const bound = map.nodes.reduce((sum, n) => {
      const launches = 2 + Math.floor((n.right - n.left) / options.launchStride);
      const runs = 6 + launches * scripts * (1 + map.nodes.length * (scripts + 2));
      return sum + runs * options.horizonSteps;
    }, 0);
    expect(map.work.steps).toBeGreaterThan(0);
    expect(map.work.steps).toBeLessThanOrEqual(bound);
    expect(buildMovementMap(options, profile, area([...layouts.wall])).work).toEqual(map.work);
  });
});

// Ground runs with gaps, scattered ledges and solid platforms, and walls, from a fixed seed.
const heavy = (seed: number, width: number) => {
  let s = seed;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const int = (low: number, span: number) => low + Math.floor(next() * span);
  const colliders: TraversalCollider<string>[] = [];
  for (let x = 0, i = 0; x < width; i++) {
    const w = int(8, 20);
    colliders.push(solid(`g${i}`, rect(x, int(20, 3), w, 10)));
    x += w + (next() < 0.4 ? int(2, 5) : 0);
  }
  for (let i = 0; i < width / 6; i++) {
    const make = next() < 0.5 ? ledge : solid;
    const x = int(0, width);
    const y = int(-10, 28) + (next() < 0.3 ? 0.5 : 0);
    colliders.push(make(`p${i}`, rect(x, y, int(3, 9), 1)));
  }
  for (let i = 0; i < width / 20; i++) {
    const top = int(6, 12);
    colliders.push(solid(`w${i}`, rect(int(0, width), top, 2, 22 - top)));
  }
  return colliders;
};
const callerStep: MapStep<string> = (context, input, state) => stepTraversal(context, input, state);
const tall: MovementProfile = {
  ...profile,
  body: { height: 3, offset: { x: 1, y: 2 }, width: 1.5 },
  climb: { height: 6, speed: 4 },
  jumpSpeed: 12,
  maxFallSpeed: 9,
};
const hops: MapBuildOptions<string>["jumps"] = [
  { hold: { jump: true, move: 1 } },
  { hold: { jump: true, move: -1 }, jumpSpeed: 6 },
  {
    afterApex: { jump: false, move: 0 },
    hold: { jump: true, move: 1 },
    lead: [
      { jump: true, move: -1 },
      { jump: true, move: -1 },
      { jump: false, move: 0 },
    ],
  },
  { afterApex: { jump: true, move: 0 }, hold: { jump: true, move: -1 }, jumpSpeed: 14 },
];

describe("movement map heavy layouts", () => {
  // Hashes and kernel steps of the same builds from the unpruned, unindexed v0.16.0 builder.
  it.each([
    ["default step", options, profile, 1, 160, false, "181dca81c0e1eef4", 16852],
    [
      "caller step",
      { ...options, step: callerStep },
      profile,
      1,
      160,
      false,
      "181dca81c0e1eef4",
      16852,
    ],
    [
      "offset body, fall clamp and climb",
      { ...options, horizonSteps: 60, launchStride: 3 },
      tall,
      2,
      120,
      false,
      "d6499ee6d263560e",
      27595,
    ],
    [
      "lead, short and long hops and a hazard",
      { ...options, jumps: hops },
      profile,
      3,
      120,
      true,
      "edf4a3d258215f8b",
      13559,
    ],
  ] as const)(
    "builds the v0.16.0 map in fewer kernel steps: %s",
    (_, buildOptions, buildProfile, seed, width, hazard, golden, steps) => {
      const map = buildMovementMap(buildOptions, buildProfile, {
        blocked: hazard ? hazardsIn(rect(59, 5, 2, 10)) : () => false,
        bounds: rect(-20, -40, width + 40, 80),
        colliders: heavy(seed, width),
        deps: () => [],
      });
      expect(mapHash(String, map)).toBe(golden);
      expect(map.work.steps).toBeLessThan(steps);
    },
  );
});

describe("movement map at a fine timestep", () => {
  // A heavy layout at six times the scale, stepped at 1/120 s with fixed-impulse jumps, so legs
  // run long enough for the default step's falling-leg cuts and shared leg prefixes to apply.
  const scaled = heavy(4, 160).map((c) => {
    const r = rect(c.before.x * 6, c.before.y * 6, c.before.width * 6, c.before.height * 6);
    return { ...c, after: r, before: r };
  });
  const fixedImpulse: MapBuildOptions<string>["jumps"] = ([-1, 0, 1] as const).flatMap((d) => {
    const script = { hold: { jump: false, move: d }, lead: [{ jump: true, move: d }] };
    return d === 0 ? [script] : [script, { ...script, afterApex: { jump: false, move: 0 } }];
  });
  const fineOptions: MapBuildOptions<string> = {
    dtSeconds: 1 / 120,
    epsilon: 1e-6,
    horizonSteps: 120,
    jumps: fixedImpulse,
    launchStride: 24,
    maxCollisionSteps: 16,
    window: rect(240, -240, 480, 480),
  };
  const fine: MovementProfile = {
    body: { height: 10, offset: { x: 1, y: 2 }, width: 10 },
    gravity: 900,
    jumpSpeed: 330,
    maxFallSpeed: 420,
    walkSpeed: 70,
  };
  const fineArea: MapArea<string> = {
    blocked: () => false,
    bounds: rect(-120, -240, 1200, 480),
    colliders: scaled,
    deps: () => [],
  };
  it("matches the v0.17.0 hash with the default and a caller step, in fewer default steps", () => {
    const map = buildMovementMap(fineOptions, fine, fineArea);
    const called = buildMovementMap({ ...fineOptions, step: callerStep }, fine, fineArea);
    expect(mapHash(String, map)).toBe("97857d53b988e219");
    expect(mapHash(String, called)).toBe("97857d53b988e219");
    expect(map.work.steps).toBeLessThan(called.work.steps * 0.6);
  });
});

const within = (outer: Readonly<Rect>, r: Readonly<Rect>) =>
  r.x >= outer.x - 1e-7 &&
  r.y >= outer.y - 1e-7 &&
  r.x + r.width <= outer.x + outer.width + 1e-7 &&
  r.y + r.height <= outer.y + outer.height + 1e-7;
const withoutId = <T extends { readonly id: unknown }>(item: T): Omit<T, "id"> =>
  Object.fromEntries(Object.entries(item).filter(([key]) => key !== "id")) as Omit<T, "id">;
// The full map's nodes whose hitbox range lies inside the window and the edges among them whose
// sweep lies inside it, renumbered in order, without ids.
const restrict = (full: MovementMap<string>, window: Rect) => {
  const kept = full.nodes.filter((n) =>
    within(window, rect(n.left, n.y - 2, n.right - n.left + 2, 2)),
  );
  const index = new Map(kept.map((n, i) => [n.id, i]));
  return {
    edges: full.edges
      .filter((e) => index.has(e.from) && index.has(e.to) && within(window, e.sweep))
      .map((e) => ({ ...withoutId(e), from: index.get(e.from), to: index.get(e.to) })),
    nodes: kept.map(withoutId),
  };
};
const strip = (map: MovementMap<string>) => ({
  edges: map.edges.map(withoutId),
  nodes: map.nodes.map(withoutId),
});
// Whether every span meets the window wholly or not at all.
const uncut = (full: MovementMap<string>, window: Rect) =>
  full.nodes.every((n) => {
    const span = rect(n.left, n.y - 2, n.right - n.left + 2, 2);
    const apart =
      n.y - 2 < window.y ||
      n.y > window.y + window.height ||
      n.right + 2 <= window.x ||
      n.left >= window.x + window.width;
    return apart || within(window, span);
  });

describe("movement map windows", () => {
  const heavyArea = (seed: number, width: number): MapArea<string> => ({
    blocked: () => false,
    bounds: rect(-20, -40, width + 40, 80),
    colliders: heavy(seed, width),
    deps: () => [],
  });
  it.each([
    ["every span", layouts.gap, rect(-5, 0, 45, 15)],
    ["one of two spans", layouts.gap, rect(-5, 0, 16, 15)],
    ["wall top", layouts.wall, rect(0, -10, 40, 25)],
    ["upper ledge only", layouts.drop, rect(-1, 0, 12, 11)],
  ] as const)("equals the full map's subgraph for a window holding: %s", (_, colliders, window) => {
    const full = buildMovementMap(options, profile, area([...colliders]));
    expect(uncut(full, window)).toBe(true);
    const map = buildMovementMap({ ...options, window }, profile, area([...colliders]));
    expect(strip(map)).toEqual(restrict(full, window));
    expect(map.nodes.map((n) => n.id)).toEqual(map.nodes.map((_, i) => i));
  });

  it("equals the full map's subgraph over a heavy layout and costs fewer kernel steps", () => {
    const window = rect(40, -40, 50, 80);
    const full = buildMovementMap(options, profile, heavyArea(1, 160));
    const map = buildMovementMap({ ...options, window }, profile, heavyArea(1, 160));
    expect(map.edges.every((e) => within(window, e.sweep))).toBe(true);
    expect(map.work.steps).toBeLessThan(full.work.steps / 2);
    if (uncut(full, window)) {
      expect(strip(map)).toEqual(restrict(full, window));
    }
  });

  it("clips a span cut by the window and keeps only edges inside it", () => {
    const flat = buildMovementMap(
      { ...options, window: rect(10, 0, 12, 15) },
      profile,
      area([...layouts.flat]),
    );
    expect(flat.nodes.map((n) => [n.y, n.left, n.right])).toEqual([[10, 10, 20]]);
    const window = rect(-1, 0, 18, 17);
    const full = buildMovementMap(options, profile, area([...layouts.drop]));
    const map = buildMovementMap({ ...options, window }, profile, area([...layouts.drop]));
    expect(map.nodes.map((n) => [n.y, n.left, n.right])).toEqual([
      [10, 0, 8],
      [16, 10, 15],
    ]);
    // The short jump lands inside the clipped range; the drop and the long jump land past it.
    const inside = full.edges.filter((e) => e.land.right <= 15 && within(window, e.sweep));
    expect(inside.map((e) => [e.kind, e.launch.left, e.land.left])).toEqual([["jump", 8, 13]]);
    expect(map.edges.map(withoutId)).toEqual(inside.map(withoutId));
  });

  it("builds nothing for a window with no spans", () => {
    const map = buildMovementMap(
      { ...options, window: rect(50, 0, 5, 5) },
      profile,
      area([...layouts.gap]),
    );
    expect([map.nodes, map.edges, map.work.steps]).toEqual([[], [], 0]);
  });

  it("adds the window line to the canonical form only when built with a window", () => {
    const full = buildMovementMap(options, profile, area([...layouts.gap]));
    const window = rect(-5, 0, 45, 15);
    const map = buildMovementMap({ ...options, window }, profile, area([...layouts.gap]));
    const lines = mapCanonical(String, map).split("\n");
    expect(lines[2]).toBe("window -5,0,45,15");
    expect(map.options.window).toEqual(window);
    expect([...lines.slice(0, 2), ...lines.slice(3)].join("\n")).toBe(mapCanonical(String, full));
    expect(mapHash(String, map)).not.toBe(mapHash(String, full));
    expect("window" in full.options).toBe(false);
    expect(mapCanonical(String, full)).not.toMatch(/^window /m);
  });

  it.each([
    ["negative width", rect(0, 0, -1, 5)],
    ["non-finite origin", rect(Number.NaN, 0, 5, 5)],
  ])("rejects a window with a %s", (_, window) => {
    expect(() => buildMovementMap({ ...options, window }, profile, area([...layouts.gap]))).toThrow(
      RangeError,
    );
  });
});

describe("movement map track climbs", () => {
  const every = () => true;
  const tracks = (map: MovementMap<string>) => map.edges.filter((e) => e.kind === "track-climb");
  const shelves = [
    solid("floor", rect(0, 10, 30, 5)),
    ledge("low", rect(10, 7, 6, 1)),
    ledge("shelf", rect(10, 4, 6, 1)),
  ];
  it.each([
    ["a climb profile and trackStart", climber, every, 1],
    ["no climb profile", profile, every, 0],
    ["no trackStart", climber, undefined, 0],
    ["a trackStart that refuses the launch", climber, (x: number) => x !== 12, 0],
  ] as const)("builds track climbs only with %s", (_, mover, trackStart, count) => {
    const map = buildMovementMap(
      { ...options, ...(trackStart && { trackStart }) },
      mover,
      area([...layouts.climb]),
    );
    expect(tracks(map)).toHaveLength(count);
    expect(map.edges.filter((e) => e.kind === "climb")).toHaveLength(mover.climb ? 1 : 0);
  });

  it("passes trackStart each launch point with its node", () => {
    const seen: [number, number][] = [];
    buildMovementMap(
      {
        ...options,
        trackStart: (x, node) => {
          seen.push([x, node.y]);
          return true;
        },
      },
      climber,
      area([...layouts.climb]),
    );
    expect(seen.filter(([, y]) => y === 10).map(([x]) => x)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it.each([
    ["a solid ceiling", [...layouts.climb, solid("roof", rect(11, 0, 4, 1))], () => false],
    ["a blocked column", [...layouts.climb], hazardsIn(rect(12, 1, 2, 1))],
  ] as const)("refuses a column with %s", (_, colliders, blocked) => {
    const map = buildMovementMap(
      { ...options, trackStart: every },
      climber,
      area([...colliders], blocked),
    );
    expect(tracks(map)).toEqual([]);
  });

  it.each([
    ["rising past both ledges lands on the higher", 8, 4],
    ["rising past the lower ledge lands on it", 5, 7],
  ] as const)("drops onto the first support: %s", (_, height, landY) => {
    const mover = { ...profile, climb: { height, speed: 4 } };
    const map = buildMovementMap({ ...options, trackStart: every }, mover, area([...shelves]));
    const [edge, ...rest] = tracks(map).filter((e) => map.nodes[e.from]!.y === 10);
    expect(rest).toEqual([]);
    expect(map.nodes[edge!.to]!.y).toBe(landY);
    expect(edge!.launch).toEqual({ left: 12, right: 12 });
    // Replay the drop witness from the launch hitbox raised by the climb height.
    const geometry = { colliders: shelves, complete: true };
    let state: TraversalState<string> = {
      fallFromY: 10 - height,
      grounded: false,
      vy: 0,
      x: 12,
      y: 10 - height - 2,
    };
    for (const [tick, command] of edge!.commands.entries()) {
      state = stepTraversal(
        {
          body: profile.body,
          bounds: rect(-20, -30, 100, 60),
          dtSeconds: 0.1,
          epsilon: 1e-7,
          maxCollisionSteps: 32,
          maxDrop: 60,
          profile,
          safe: () => true,
          sampleColliders: () => geometry,
        },
        { ...command, timeSeconds: tick * 0.1 },
        state,
      ).state;
    }
    expect(state.grounded).toBe(true);
    expect(state.y + 2).toBeCloseTo(landY);
    expect(edge!.seconds).toBeCloseTo(height / 4 + edge!.commands.length * 0.1);
    expect(edge!.commands.every((c) => !c.jump && c.move === 0)).toBe(true);
  });

  it("is disabled by a mask", () => {
    const map = buildMovementMap({ ...options, trackStart: every }, climber, area([...shelves]));
    const from = { node: nodeAt(map, 0, 10), x: 0 };
    const goal = { node: nodeAt(map, 12, 4) };
    const noClimb = withoutKind(map, "climb");
    expect(pathTo(map, noClimb, from, goal)?.edges.map((id) => map.edges[id]!.kind)).toEqual([
      "track-climb",
    ]);
    const neither: MapMask = {
      edge: (id) => !["climb", "track-climb"].includes(map.edges[id]!.kind),
      key: "no-climbs",
      node: () => true,
    };
    expect(pathTo(map, neither, from, goal)).toBeUndefined();
  });

  const heavyArea = (seed: number, width: number): MapArea<string> => ({
    blocked: () => false,
    bounds: rect(-20, -40, width + 40, 80),
    colliders: heavy(seed, width),
    deps: () => [],
  });
  const tallOptions = { ...options, horizonSteps: 60, launchStride: 3 };
  it.each([
    ["no climb profile accepting every start", options, profile, true, 1, 160, "181dca81c0e1eef4"],
    ["a climb profile refusing every start", tallOptions, tall, false, 2, 120, "d6499ee6d263560e"],
  ] as const)(
    "keeps the 0.16.1 hash with %s",
    (_, buildOptions, mover, accept, seed, width, golden) => {
      const trackStart = () => accept;
      const map = buildMovementMap({ ...buildOptions, trackStart }, mover, heavyArea(seed, width));
      expect(mapHash(String, map)).toBe(golden);
    },
  );

  it("matches the golden hash with track climbs on a heavy layout", () => {
    const map = buildMovementMap({ ...tallOptions, trackStart: every }, tall, heavyArea(2, 120));
    expect(tracks(map).length).toBeGreaterThan(0);
    expect(mapHash(String, map)).toBe("29672fbc424d4806");
  });
});

// The 0.18.0 queries, which the current ones must match result for result. `ties` counts edges
// settled while another accepted arrival over the same edge with the same seconds was pending,
// whose order only the binary heap decides.
const reference = (() => {
  interface Arrival {
    readonly seconds: number;
    readonly node: NodeId;
    readonly x: number;
    readonly edge: EdgeId | -1;
    readonly previous: Arrival | undefined;
  }
  const counts = { ties: 0 };
  const clamp = (low: number, high: number, value: number) => Math.min(high, Math.max(low, value));
  const before = (a: Arrival, b: Arrival) =>
    (a.seconds - b.seconds || a.node - b.node || a.edge - b.edge) < 0;
  const push = (heap: Arrival[], item: Arrival) => {
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(item, heap[parent]!)) {
        break;
      }
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = item;
  };
  const pop = (heap: Arrival[]) => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= heap.length) {
          break;
        }
        if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) {
          child++;
        }
        if (!before(heap[child]!, last)) {
          break;
        }
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  };
  const search = (
    map: MovementMap<string>,
    mask: MapMask,
    from: NodeRef,
    startSeconds: number,
    stop: ((node: MapNode<string>) => boolean) | undefined,
  ) => {
    const first = new Map<NodeId, Arrival>();
    if (!map.nodes[from.node] || !Number.isFinite(from.x)) {
      throw new RangeError("Unknown movement map node");
    }
    if (!mask.node(from.node)) {
      return { first, found: undefined };
    }
    const settled = new Set<number>();
    const heap: Arrival[] = [];
    push(heap, {
      edge: -1,
      node: from.node,
      previous: undefined,
      seconds: startSeconds,
      x: from.x,
    });
    while (heap.length) {
      const arrival = pop(heap);
      if (settled.has(arrival.edge)) {
        continue;
      }
      settled.add(arrival.edge);
      if (heap.some((a) => a.edge === arrival.edge && a.seconds === arrival.seconds)) {
        counts.ties++;
      }
      const node = map.nodes[arrival.node]!;
      if (!first.has(node.id)) {
        first.set(node.id, arrival);
        if (stop?.(node)) {
          return { first, found: arrival };
        }
      }
      for (const id of map.outgoing[node.id]!) {
        const edge = map.edges[id]!;
        if (settled.has(id) || !mask.node(edge.to)) {
          continue;
        }
        const p = clamp(edge.launch.left, edge.launch.right, arrival.x);
        const distance = Math.abs(arrival.x - p);
        const walk = distance === 0 ? 0 : distance / map.profile.walkSpeed;
        const depart = arrival.seconds + walk;
        if (!Number.isFinite(depart) || !mask.edge(id, depart)) {
          continue;
        }
        push(heap, {
          edge: id,
          node: edge.to,
          previous: arrival,
          seconds: depart + edge.seconds,
          x: clamp(edge.land.left, edge.land.right, edge.land.left + (p - edge.launch.left)),
        });
      }
    }
    return { first, found: undefined };
  };
  const distanceTo = (map: MovementMap<string>, point: Point, node: MapNode<string>) => {
    const half = map.profile.body.width / 2;
    const dx = Math.max(0, node.left + half - point.x, point.x - node.right - half);
    return Math.hypot(dx, point.y - node.y);
  };
  const pathTo = (
    map: MovementMap<string>,
    mask: MapMask,
    from: NodeRef,
    goal: MapGoal<string>,
  ): MapPath | undefined => {
    const test =
      "node" in goal
        ? (n: MapNode<string>) => n.id === goal.node
        : "point" in goal
          ? (n: MapNode<string>) => distanceTo(map, goal.point, n) <= goal.radius
          : goal.predicate;
    const { found } = search(map, mask, from, 0, test);
    if (!found) {
      return undefined;
    }
    const edges: EdgeId[] = [];
    const nodes: NodeId[] = [];
    for (let a: Arrival | undefined = found; a; a = a.previous) {
      nodes.push(a.node);
      if (a.edge !== -1) {
        edges.push(a.edge);
      }
    }
    return { edges: edges.reverse(), nodes: nodes.reverse(), seconds: found.seconds };
  };
  const reachableSet = (map: MovementMap<string>, mask: MapMask, from: NodeRef) => {
    const { first } = search(map, mask, from, 0, undefined);
    return new Set([...first.keys()].sort((a, b) => a - b));
  };
  const nearestReachable = (
    map: MovementMap<string>,
    mask: MapMask,
    from: NodeRef,
    toward: Point,
  ): NodeRef | undefined => {
    const { first } = search(map, mask, from, 0, undefined);
    let best: { node: MapNode<string>; distance: number; seconds: number } | undefined;
    for (const [id, arrival] of first) {
      const node = map.nodes[id]!;
      const distance = distanceTo(map, toward, node);
      if (
        !best ||
        (distance - best.distance || arrival.seconds - best.seconds || node.id - best.node.id) < 0
      ) {
        best = { distance, node, seconds: arrival.seconds };
      }
    }
    return (
      best && {
        node: best.node.id,
        x: clamp(best.node.left, best.node.right, toward.x - map.profile.body.width / 2),
      }
    );
  };
  const sinks = (
    map: MovementMap<string>,
    mask: MapMask,
    from: NodeRef,
    exits: readonly NodeId[],
  ) => {
    const targets = new Set(exits);
    const { first } = search(map, mask, from, 0, undefined);
    const result: NodeId[] = [];
    for (const id of [...first.keys()].sort((a, b) => a - b)) {
      const arrival = first.get(id)!;
      if (
        !targets.has(id) &&
        !search(map, mask, { node: id, x: arrival.x }, arrival.seconds, (n) => targets.has(n.id))
          .found
      ) {
        result.push(id);
      }
    }
    return result;
  };
  return { counts, nearestReachable, pathTo, reachableSet, sinks };
})();

// A deterministic hash of integers into [0, 1).
const unit = (...values: number[]) => {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  }
  return h / 2 ** 32;
};
// Masks drawn from a seed: open, nodes and edges closed at random, and edges open only in
// departure windows that shift with the edge, so arrivals at different seconds settle differently.
const masks = (seed: number): MapMask[] => [
  open,
  { edge: (id) => unit(seed, id, 1) >= 0.15, key: "edges", node: (id) => unit(seed, id) >= 0.1 },
  {
    edge: (id, depart) => Math.floor(depart * (1 + unit(seed, id, 2) * 3) + id) % 3 !== 0,
    key: "windows",
    node: () => true,
  },
  {
    edge: (id, depart) => unit(seed, id, Math.floor(depart * 2)) >= 0.35,
    key: "slots",
    node: (id) => unit(seed, id, 3) >= 0.05,
  },
];
// The heavy layout, its coordinates optionally moved off the integer grid.
const jittered = (seed: number, width: number, jitter: number) =>
  heavy(seed, width).map((c, i) => {
    const b = c.before;
    const r = rect(
      b.x + unit(seed, i, 4) * jitter,
      b.y + unit(seed, i, 5) * jitter,
      b.width,
      b.height,
    );
    return { ...c, after: r, before: r };
  });
const queryArea = (colliders: TraversalCollider<string>[]): MapArea<string> => ({
  blocked: () => false,
  bounds: rect(-20, -40, 160, 80),
  colliders,
  deps: () => [],
});

describe("movement map queries match 0.18.0", () => {
  const cases = [
    ["integer grid", 5, 0, options, profile],
    ["integer grid with hops", 6, 0, { ...options, jumps: hops }, profile],
    ["jittered", 7, 0.37, options, profile],
    ["jittered, offset body and climb", 8, 0.61, { ...options, launchStride: 3 }, tall],
  ] as const;
  it.each(cases)(
    "returns every 0.18.0 result over random starts, goals and masks: %s",
    (_, seed, jitter, buildOptions, mover) => {
      const map = buildMovementMap(buildOptions, mover, queryArea(jittered(seed, 100, jitter)));
      expect(map.edges.length).toBeGreaterThan(100);
      reference.counts.ties = 0;
      let compared = 0;
      let paths = 0;
      for (const mask of masks(seed)) {
        for (let k = 0; k < 16; k++) {
          const node = map.nodes[Math.floor(unit(seed, k, 6) * map.nodes.length)]!;
          const from = {
            node: node.id,
            x: node.left + (node.right - node.left) * unit(seed, k, 7),
          };
          const point = { x: unit(seed, k, 8) * 120 - 10, y: unit(seed, k, 9) * 50 - 15 };
          const target = Math.floor(unit(seed, k, 10) * map.nodes.length) as NodeId;
          const goals: MapGoal<string>[] = [
            { node: target },
            { point, radius: 1 + unit(seed, k, 11) * 4 },
            { predicate: (n) => n.y < point.y && n.kind === "static" },
          ];
          for (const goal of goals) {
            const path = pathTo(map, mask, from, goal);
            expect(path).toEqual(reference.pathTo(map, mask, from, goal));
            const combined = pathOrNearest(map, mask, from, goal, point);
            expect(combined.path).toEqual(path);
            const nearest = path ? undefined : nearestReachable(map, mask, from, point);
            expect(combined.fallback?.target).toEqual(nearest);
            if (combined.fallback) {
              expect(combined.fallback.path).toEqual(
                pathTo(map, mask, from, { node: combined.fallback.target.node }),
              );
            }
            paths += path ? 1 : 0;
            compared++;
          }
          expect(nearestReachable(map, mask, from, point)).toEqual(
            reference.nearestReachable(map, mask, from, point),
          );
          expect(reachableSet(map, mask, from)).toEqual(reference.reachableSet(map, mask, from));
          if (k < 4) {
            const exits = [target, node.id];
            expect(sinks(map, mask, from, exits)).toEqual(reference.sinks(map, mask, from, exits));
          }
        }
      }
      expect(compared).toBe(4 * 16 * 3);
      expect(paths).toBeGreaterThan(compared / 4);
      expect(paths).toBeLessThan(compared);
      // The layouts exercise equal arrivals over one edge, which must still match.
      expect(reference.counts.ties).toBeGreaterThan(0);
    },
  );
});
