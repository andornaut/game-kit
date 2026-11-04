import { describe, expect, it } from "vitest";

import { type Point, type Rect, rectsOverlap } from "../rect.ts";
import {
  type AirArea,
  type AirBuildOptions,
  type AirEdgeId,
  type AirGoal,
  type AirMap,
  airMapCanonical,
  airMapHash,
  type AirMask,
  type AirNodeId,
  airPath,
  buildAirMap,
  type FlightProfile,
  locateAir,
  nearestReachableAir,
  reachableAir,
} from "./airMap.ts";

const TILE = 16;
const OPTIONS: AirBuildOptions = { axisChangeSeconds: 0.25, tileSize: TILE };
// Half a second per one-tile cell.
const PROFILE: FlightProfile = {
  body: { height: TILE, offset: { x: -2, y: -4 }, width: TILE },
  cell: 1,
  speed: 32,
};
const OPEN: AirMask = { edge: () => true, key: "open", node: () => true };

// "#" blocks its tile; "c" is clear but reported by deps as `c<column>,<row>`.
function layout(rows: readonly string[], perches: readonly Rect[] = []): AirArea<string> {
  const tiles = rows.flatMap((line, row) =>
    [...line].map((char, column) => ({
      char,
      id: `c${column},${row}`,
      rect: { height: TILE, width: TILE, x: column * TILE, y: row * TILE },
    })),
  );
  const touching = (char: string, rect: Readonly<Rect>) =>
    tiles.filter((tile) => tile.char === char && rectsOverlap(tile.rect, rect));
  return {
    blocked: (rect) => touching("#", rect).length > 0,
    bounds: { height: rows.length * TILE, width: (rows[0] ?? "").length * TILE, x: 0, y: 0 },
    deps: (rect) => touching("c", rect).map((tile) => tile.id),
    perches,
  };
}

function build(
  rows: readonly string[],
  perches: readonly Rect[] = [],
  options = OPTIONS,
  profile = PROFILE,
): AirMap<string> {
  return buildAirMap(options, profile, layout(rows, perches));
}

// The air node whose hitbox sits at the given cell.
function cell(map: AirMap<string>, column: number, row: number): AirNodeId {
  const node = map.nodes.find(
    (n) => n.kind === "air" && n.body.x === column * TILE && n.body.y === row * TILE,
  );
  if (node === undefined) {
    throw new Error(`No air node at ${column},${row}`);
  }
  return node.id;
}

function edgeBetween(map: AirMap<string>, from: AirNodeId, to: AirNodeId): AirEdgeId {
  const edge = map.edges.find((e) => e.from === from && e.to === to);
  if (edge === undefined) {
    throw new Error(`No edge ${from} to ${to}`);
  }
  return edge.id;
}

function cells(map: AirMap<string>, ids: readonly AirNodeId[]): string[] {
  return ids.map((id) => {
    const node = map.nodes[id];
    return node === undefined ? "?" : `${node.body.x / TILE},${node.body.y / TILE}`;
  });
}

function turns(map: AirMap<string>, edges: readonly AirEdgeId[]): number {
  const axes = edges.map((id) => map.edges[id]?.axis);
  return axes.filter((axis, index) => index > 0 && axis !== axes[index - 1]).length;
}

describe("buildAirMap", () => {
  it.each([
    { edges: 34, name: "an open box", nodes: 12, rows: ["....", "....", "...."] },
    { edges: 44, name: "a wall with a gap", nodes: 17, rows: ["..#..", "..#..", "..#..", "....."] },
    { edges: 0, name: "a solid box", nodes: 0, rows: ["##", "##"] },
  ])("builds clear cells and 4-neighbour fly edges in $name", ({ edges, nodes, rows }) => {
    const map = build(rows);
    expect(map.nodes).toHaveLength(nodes);
    expect(map.edges).toHaveLength(edges);
    expect(map.edges.every((edge) => edge.kind === "fly" && edge.seconds === 0.5)).toBe(true);
  });

  it("sorts nodes by (y, x) and edges by (from, to), with ids equal to indices", () => {
    const map = build(["...", "..."]);
    expect(map.nodes.map((node) => node.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      cells(
        map,
        map.nodes.map((node) => node.id),
      ),
    ).toEqual(["0,0", "1,0", "2,0", "0,1", "1,1", "2,1"]);
    expect(map.edges.map((edge) => edge.id)).toEqual(map.edges.map((_, index) => index));
    const keys = map.edges.map((edge) => edge.from * 100 + edge.to);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(map.outgoing[0]).toEqual([edgeBetween(map, 0 as AirNodeId, 1 as AirNodeId), 1]);
  });

  it("steps by cell tiles and keeps the whole hitbox inside the bounds", () => {
    const map = build(["......", "......", "......"], [], OPTIONS, { ...PROFILE, cell: 2 });
    expect(
      cells(
        map,
        map.nodes.map((node) => node.id),
      ),
    ).toEqual(["0,0", "2,0", "4,0", "0,2", "2,2", "4,2"]);
    expect(map.edges.every((edge) => edge.seconds === 1)).toBe(true);
  });

  it("reports deps for nodes and for each edge's sweep", () => {
    const map = build(["c.."]);
    const [first, second, third] = [cell(map, 0, 0), cell(map, 1, 0), cell(map, 2, 0)] as const;
    expect(map.nodes.map((node) => node.deps)).toEqual([["c0,0"], [], []]);
    expect(map.edges[edgeBetween(map, second, first)]?.deps).toEqual(["c0,0"]);
    expect(map.edges[edgeBetween(map, second, third)]?.deps).toEqual([]);
  });

  it.each([
    { name: "tile size", options: { ...OPTIONS, tileSize: 0 }, profile: PROFILE },
    { name: "axis change", options: { ...OPTIONS, axisChangeSeconds: -1 }, profile: PROFILE },
    { name: "speed", options: OPTIONS, profile: { ...PROFILE, speed: 0 } },
    { name: "cell", options: OPTIONS, profile: { ...PROFILE, cell: Number.NaN } },
    {
      name: "body",
      options: OPTIONS,
      profile: { ...PROFILE, body: { ...PROFILE.body, width: -1 } },
    },
  ])("rejects an invalid $name", ({ options, profile }) => {
    expect(() => build(["..."], [], options, profile)).toThrow(RangeError);
  });

  it.each([
    { name: "not the body's size", perch: { height: 8, width: TILE, x: 0, y: 0 } },
    { name: "outside the bounds", perch: { height: TILE, width: TILE, x: 40, y: 0 } },
  ])("rejects a perch $name", ({ perch }) => {
    expect(() => build(["..."], [perch])).toThrow(RangeError);
  });
});

// A 12-pixel-high body over a one-tile ledge; the perch is the hitbox standing on the ledge top.
const PERCH_PROFILE: FlightProfile = { ...PROFILE, body: { ...PROFILE.body, height: 12 } };
const PERCH: Rect = { height: 12, width: TILE, x: TILE, y: 20 };
const LEDGE = ["...", "...", ".#."];

describe("perches", () => {
  const map = build(LEDGE, [PERCH], OPTIONS, PERCH_PROFILE);
  const perch = map.nodes.find((node) => node.kind === "perch");

  it("links each perch to the lowest clear cell above it with land and lift edges", () => {
    expect(perch?.body).toEqual(PERCH);
    const above = cell(map, 1, 1);
    const land = map.edges[edgeBetween(map, above, perch?.id as AirNodeId)];
    const lift = map.edges[edgeBetween(map, perch?.id as AirNodeId, above)];
    expect(land).toMatchObject({ axis: "y", kind: "land", seconds: 4 / 32 });
    expect(lift).toMatchObject({ axis: "y", kind: "lift", seconds: 4 / 32 });
    expect(land?.sweep).toEqual({ height: 16, width: TILE, x: TILE, y: TILE });
  });

  it("routes onto a perch with land and away with lift", () => {
    const to = airPath(map, OPEN, cell(map, 0, 0), { node: perch?.id as AirNodeId });
    expect(to?.edges.map((id) => map.edges[id]?.kind).at(-1)).toBe("land");
    const away = airPath(map, OPEN, perch?.id as AirNodeId, { node: cell(map, 2, 0) });
    expect(away?.edges.map((id) => map.edges[id]?.kind)[0]).toBe("lift");
  });

  it("locates a landed body on its perch", () => {
    expect(locateAir(map, PERCH)).toBe(perch?.id);
  });
});

describe("airPath", () => {
  it.each([
    {
      cost: 2,
      from: [0, 0],
      goal: [3, 1],
      name: "crosses an open box",
      rows: ["....", "....", "...."],
    },
    {
      cost: 5,
      from: [0, 0],
      goal: [4, 0],
      name: "detours under a wall",
      rows: ["..#..", "..#..", "..#..", "....."],
    },
  ])("$name in the least travel time", ({ cost, from, goal, rows }) => {
    const map = build(rows);
    const path = airPath(map, OPEN, cell(map, from[0] ?? 0, from[1] ?? 0), {
      node: cell(map, goal[0] ?? 0, goal[1] ?? 0),
    });
    expect(path?.seconds).toBe(cost);
    expect(path?.nodes).toHaveLength(cost * 2 + 1);
    expect(path?.edges).toHaveLength(cost * 2);
    path?.edges.forEach((id, index) => {
      expect(map.edges[id]?.from).toBe(path.nodes[index]);
      expect(map.edges[id]?.to).toBe(path.nodes[index + 1]);
    });
  });

  // The staircase from S to G is 6 cells with 5 turns; the ring is 10 cells with 3 turns.
  const STAIRS = [".....", ".###.", ".##..", ".#..#", ".S.##"];
  it.each([
    { axisChangeSeconds: 0, rows: STAIRS, seconds: 3, to: [4, 1], turns: 5 },
    { axisChangeSeconds: 0.25, rows: STAIRS, seconds: 3, to: [4, 1], turns: 5 },
    { axisChangeSeconds: 2, rows: STAIRS, seconds: 5, to: [4, 1], turns: 3 },
    {
      axisChangeSeconds: 0.25,
      rows: ["....", "....", "....", "...."],
      seconds: 3,
      to: [3, 3],
      turns: 1,
    },
  ])(
    "takes $turns turns in $seconds s with axis change cost $axisChangeSeconds",
    ({ axisChangeSeconds, rows, seconds, to, turns: expected }) => {
      const map = build(rows, [], { ...OPTIONS, axisChangeSeconds });
      const start = rows === STAIRS ? cell(map, 1, 4) : cell(map, 0, 0);
      const path = airPath(map, OPEN, start, { node: cell(map, to[0] ?? 0, to[1] ?? 0) });
      expect(path?.seconds).toBe(seconds);
      expect(turns(map, path?.edges ?? [])).toBe(expected);
    },
  );

  it.each<{ goal: AirGoal<string>; name: string; to: string }>([
    { goal: { point: { x: 56, y: 24 }, radius: 4 }, name: "a point", to: "3,1" },
    { goal: { point: { x: 64, y: 0 }, radius: 20 }, name: "a far point", to: "3,0" },
    { goal: { predicate: (node) => node.body.y === 2 * TILE }, name: "a predicate", to: "0,2" },
  ])("stops at the first node meeting $name", ({ goal, to }) => {
    const map = build(["....", "....", "...."]);
    const path = airPath(map, OPEN, cell(map, 0, 0), goal);
    expect(cells(map, path?.nodes.slice(-1) ?? [])).toEqual([to]);
  });

  it("returns the start alone when it meets the goal", () => {
    const map = build(["..."]);
    expect(airPath(map, OPEN, cell(map, 1, 0), { node: cell(map, 1, 0) })).toEqual({
      edges: [],
      nodes: [1],
      seconds: 0,
    });
  });

  it("returns undefined for an unreachable goal", () => {
    const map = build(["..#..", "..#..", "..#.."]);
    expect(airPath(map, OPEN, cell(map, 0, 0), { node: cell(map, 4, 0) })).toBeUndefined();
    expect(airPath(map, OPEN, cell(map, 0, 0), { predicate: () => false })).toBeUndefined();
  });

  it("is the same on every call", () => {
    const map = build(["....", "..#.", "...."]);
    const goal = { node: cell(map, 3, 2) };
    expect(airPath(map, OPEN, cell(map, 0, 0), goal)).toEqual(
      airPath(map, OPEN, cell(map, 0, 0), goal),
    );
  });
});

describe("masks", () => {
  const corridor = build(["...."]);
  const ends = { from: cell(corridor, 0, 0), goal: { node: cell(corridor, 3, 0) } };

  it("skips disabled nodes", () => {
    const mask: AirMask = { ...OPEN, key: "gap", node: (id) => id !== cell(corridor, 2, 0) };
    expect(airPath(corridor, mask, ends.from, ends.goal)).toBeUndefined();
    expect([...reachableAir(corridor, mask, ends.from)]).toEqual([0, 1]);
    expect(reachableAir(corridor, { ...OPEN, node: () => false }, ends.from).size).toBe(0);
  });

  it("skips a disabled edge by detouring", () => {
    const map = build(["...", "..."]);
    const cut = edgeBetween(map, cell(map, 0, 0), cell(map, 1, 0));
    const mask: AirMask = { ...OPEN, edge: (id) => id !== cut, key: "cut" };
    const path = airPath(map, mask, cell(map, 0, 0), { node: cell(map, 2, 0) });
    expect(path?.seconds).toBe(2);
    expect(path?.edges).not.toContain(cut);
  });

  it.each([
    { found: true, until: 1.5 },
    { found: false, until: 1 },
  ])("passes each edge its departure seconds (enabled before $until)", ({ found, until }) => {
    const mask: AirMask = { ...OPEN, edge: (_, depart) => depart < until, key: `until ${until}` };
    expect(airPath(corridor, mask, ends.from, ends.goal) !== undefined).toBe(found);
  });
});

describe("reachability and location", () => {
  const map = build(["..#..", "..#..", "..#.."]);

  it("reaches only one side of a wall", () => {
    expect(cells(map, [...reachableAir(map, OPEN, cell(map, 0, 0))])).toEqual([
      "0,0",
      "1,0",
      "0,1",
      "1,1",
      "0,2",
      "1,2",
    ]);
  });

  it.each<{ to: string; toward: Point }>([
    { to: "1,1", toward: { x: 72, y: 24 } },
    { to: "0,0", toward: { x: -50, y: -50 } },
  ])("finds the reachable node nearest $toward", ({ to, toward }) => {
    const nearest = nearestReachableAir(map, OPEN, cell(map, 0, 0), toward);
    expect(cells(map, nearest === undefined ? [] : [nearest])).toEqual([to]);
  });

  it.each<{ body: Rect; to: string | undefined }>([
    { body: { height: TILE, width: TILE, x: 18, y: 2 }, to: "1,0" },
    { body: { height: TILE, width: TILE, x: 8, y: 8 }, to: "0,0" },
    { body: { height: TILE, width: TILE, x: 200, y: 0 }, to: undefined },
  ])("locates $body", ({ body, to }) => {
    const found = locateAir(map, body);
    expect(found === undefined ? undefined : cells(map, [found])[0]).toBe(to);
  });
});

describe("airMapHash", () => {
  const perches = [PERCH, { ...PERCH, x: 2 * TILE - 2 }];
  const rows = ["c..", "...", ".##"];

  it("documents its canonical form", () => {
    const map = build(["c."]);
    expect(airMapCanonical(String, map).split("\n")).toEqual([
      "air-map 1",
      "options 16 0.25",
      "profile 16,16,-2,-4 32 1",
      "node 0 air 0,0,16,16 c0,0",
      "node 1 air 16,0,16,16 ",
      "edge 0 0 1 fly x 0.5 0,0,32,16 c0,0",
      "edge 1 1 0 fly x 0.5 0,0,32,16 c0,0",
    ]);
  });

  it("is a pure function of options, profile and area, whatever the perch order", () => {
    const first = build(rows, perches, OPTIONS, PERCH_PROFILE);
    const second = build(rows, [...perches].reverse(), OPTIONS, PERCH_PROFILE);
    expect(airMapHash(String, second)).toBe(airMapHash(String, first));
    expect(airMapHash(String, first)).toBe("846af89bd6b857e7");
    expect(
      airMapHash(String, build(rows, perches, { ...OPTIONS, axisChangeSeconds: 1 }, PERCH_PROFILE)),
    ).not.toBe(airMapHash(String, first));
  });
});
