import { describe, expect, it } from "vitest";

import type { Rect } from "../rect.ts";
import {
  buildMovementMap,
  DEFAULT_JUMP_SCRIPTS,
  type EdgeId,
  locate,
  type MapArea,
  type MapBuildOptions,
  mapCanonical,
  type MapEdgeKind,
  mapHash,
  type MapMask,
  type MapStep,
  type MovementMap,
  type MovementProfile,
  nearestReachable,
  type NodeId,
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
