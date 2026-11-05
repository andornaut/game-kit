import type { Point, Rect } from "../rect.ts";
import { fnv1a64 } from "./fnv1a64.ts";
import {
  stepTraversal,
  type TraversalCollider,
  type TraversalCommand,
  type TraversalContext,
  type TraversalInput,
  type TraversalProfile,
  type TraversalState,
  type TraversalStepResult,
} from "./traversal.ts";

// Branded indices into `MovementMap.nodes` and `MovementMap.edges`.
export type NodeId = number & { readonly __brand: "NodeId" };
export type EdgeId = number & { readonly __brand: "EdgeId" };

export interface MovementProfile extends TraversalProfile {
  readonly body: { readonly width: number; readonly height: number; readonly offset: Point };
  // Vertical climbing through a clear column, in caller units and units per second.
  readonly climb?: { readonly height: number; readonly speed: number };
}

// Static geometry only: every collider has `before` equal to `after` and no segments.
export interface MapArea<Id> {
  readonly bounds: Readonly<Rect>;
  readonly colliders: readonly TraversalCollider<Id>[];
  // Whether a swept hitbox meets a static hazard; such spans split and such edges are invalid.
  readonly blocked: (sweep: Readonly<Rect>) => boolean;
  // Caller ids (crumbling supports, timed hazards, movers) a node's or edge's sweep depends on.
  readonly deps: (sweep: Readonly<Rect>) => readonly Id[];
  // The caller's node kind for a span; "static" when omitted.
  readonly kind?: (supportId: Id, sweep: Readonly<Rect>) => string;
}

// One jump witness: `lead` commands from the launch tick, then `hold` until landing, switching to
// `afterApex` from the first airborne tick whose vertical speed is not negative. The first command
// must jump. `jumpSpeed` replaces the profile's impulse for this script (a short hop).
export interface MapJumpScript {
  readonly lead?: readonly TraversalCommand[];
  readonly hold: TraversalCommand;
  readonly afterApex?: TraversalCommand;
  readonly jumpSpeed?: number;
}

// Move -1, 0 and +1 with jump held, plus the apex air-stop for each direction.
export const DEFAULT_JUMP_SCRIPTS: readonly MapJumpScript[] = [
  { hold: { jump: true, move: -1 } },
  { hold: { jump: true, move: 0 } },
  { hold: { jump: true, move: 1 } },
  { afterApex: { jump: true, move: 0 }, hold: { jump: true, move: -1 } },
  { afterApex: { jump: true, move: 0 }, hold: { jump: true, move: 1 } },
];

// The fixed step every witness runs through; `stepTraversal`'s stateless overload by default.
export type MapStep<Id> = (
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
) => TraversalStepResult<Id>;

export interface MapBuildOptions<Id> {
  readonly dtSeconds: number;
  readonly epsilon: number;
  // Kernel ticks allowed for one leg of an edge.
  readonly horizonSteps: number;
  readonly jumps?: readonly MapJumpScript[];
  // Distance between jump launches along a span, besides both ends.
  readonly launchStride: number;
  readonly maxCollisionSteps: number;
  readonly step?: MapStep<Id>;
}

// A closed range of hitbox-left x positions.
export interface MapRange {
  readonly left: number;
  readonly right: number;
}

export interface MapNode<Id> {
  readonly id: NodeId;
  readonly supportId: Id;
  // Support top, which is the hitbox bottom.
  readonly y: number;
  // Hitbox-left x range whose whole hitbox is supported and clear.
  readonly left: number;
  readonly right: number;
  readonly kind: string;
  readonly deps: readonly Id[];
}

export type MapEdgeKind = "climb" | "drop" | "jump" | "walk" | "wall-top";

export interface MapEdge<Id> {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: MapEdgeKind;
  readonly launch: MapRange;
  readonly land: MapRange;
  // Kernel witness, proven from each sampled launch point; empty for climbs.
  readonly commands: readonly TraversalCommand[];
  readonly seconds: number;
  readonly sweep: Readonly<Rect>;
  readonly deps: readonly Id[];
}

// Nodes and edges are indexed by id; `outgoing` lists each node's edge ids in ascending order.
// `options` holds the resolved jump scripts and leaves out the caller's step.
export interface MovementMap<Id> {
  readonly edges: readonly MapEdge<Id>[];
  readonly nodes: readonly MapNode<Id>[];
  readonly options: Omit<MapBuildOptions<Id>, "jumps" | "step"> & {
    readonly jumps: readonly MapJumpScript[];
  };
  readonly outgoing: readonly (readonly EdgeId[])[];
  readonly profile: MovementProfile;
  // Kernel steps spent building.
  readonly work: { readonly steps: number };
}

// A position on a node: its id and the hitbox-left x.
export interface NodeRef {
  readonly node: NodeId;
  readonly x: number;
}

export interface MapMask {
  readonly key: string;
  readonly node: (id: NodeId) => boolean;
  // Travel seconds from the path start at which the edge departs.
  readonly edge: (id: EdgeId, departSeconds: number) => boolean;
}

export type MapGoal<Id> =
  | { readonly node: NodeId }
  | { readonly point: Point; readonly radius: number }
  | { readonly predicate: (node: MapNode<Id>) => boolean };

export interface MapPath {
  readonly edges: readonly EdgeId[];
  // The start node, then each edge's target.
  readonly nodes: readonly NodeId[];
  readonly seconds: number;
}

function union(a: Readonly<Rect> | undefined, b: Readonly<Rect>): Rect {
  if (!a) {
    return { height: b.height, width: b.width, x: b.x, y: b.y };
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    x,
    y,
  };
}
function overlaps(epsilon: number, a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return (
    a.x < b.x + b.width - epsilon &&
    b.x < a.x + a.width - epsilon &&
    a.y < b.y + b.height - epsilon &&
    b.y < a.y + a.height - epsilon
  );
}
function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}
function clamp(low: number, high: number, value: number): number {
  return Math.min(high, Math.max(low, value));
}
function commandCode(commands: readonly TraversalCommand[]): string {
  return commands.map((c) => (c.jump ? "LSR" : "lsr")[c.move + 1]).join("");
}

// The kernel's full-foot support rule over static colliders: the leftmost touching collider.
function supportOf<Id>(
  epsilon: number,
  colliders: readonly TraversalCollider<Id>[],
  rect: Readonly<Rect>,
): TraversalCollider<Id> | undefined {
  const candidates = colliders
    .filter(
      (c) =>
        Math.abs(c.before.y - rect.y - rect.height) <= epsilon &&
        c.before.x < rect.x + rect.width &&
        c.before.x + c.before.width > rect.x,
    )
    .sort((a, b) => a.before.x - b.before.x);
  let edge = rect.x;
  for (const c of candidates) {
    if (c.before.x > edge + epsilon) {
      return undefined;
    }
    edge = Math.max(edge, c.before.x + c.before.width);
    if (edge >= rect.x + rect.width - epsilon) {
      return candidates[0];
    }
  }
  return undefined;
}

function validateBuild<Id>(
  options: MapBuildOptions<Id>,
  profile: MovementProfile,
  area: MapArea<Id>,
): void {
  const { body, climb } = profile;
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  const nonNegative = (v: number) => Number.isFinite(v) && v >= 0;
  const count = (v: number) => Number.isSafeInteger(v) && v >= 1;
  const scripts = options.jumps ?? DEFAULT_JUMP_SCRIPTS;
  const command = (c: TraversalCommand) =>
    [-1, 0, 1].includes(c.move) && typeof c.jump === "boolean";
  if (
    !positive(options.dtSeconds) ||
    !nonNegative(options.epsilon) ||
    !positive(options.launchStride) ||
    !count(options.horizonSteps) ||
    !count(options.maxCollisionSteps) ||
    !positive(body.width) ||
    !positive(body.height) ||
    !finite(body.offset.x, body.offset.y) ||
    !positive(profile.gravity) ||
    !positive(profile.maxFallSpeed) ||
    !nonNegative(profile.walkSpeed) ||
    !nonNegative(profile.jumpSpeed) ||
    (climb !== undefined && (!nonNegative(climb.height) || !positive(climb.speed))) ||
    !finite(area.bounds.x, area.bounds.y, area.bounds.width, area.bounds.height) ||
    !scripts.every(
      (s) =>
        (s.lead ?? []).every(command) &&
        command(s.hold) &&
        (s.afterApex === undefined || command(s.afterApex)) &&
        (s.jumpSpeed === undefined || nonNegative(s.jumpSpeed)) &&
        (s.lead?.[0] ?? s.hold).jump,
    )
  ) {
    throw new RangeError("Invalid movement map options or profile");
  }
  const ids = new Set<Id>();
  for (const c of area.colliders) {
    const { after: a, before: b } = c;
    if (
      ids.has(c.supportId) ||
      c.segments !== undefined ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      !finite(b.x, b.y, b.width, b.height) ||
      b.width <= 0 ||
      b.height <= 0
    ) {
      throw new RangeError("Movement map colliders must be static with unique support ids");
    }
    ids.add(c.supportId);
  }
}

interface Span<Id> {
  readonly y: number;
  readonly left: number;
  readonly right: number;
  readonly supportId: Id;
}

function spans<Id>(
  options: MapBuildOptions<Id>,
  profile: MovementProfile,
  area: MapArea<Id>,
  rise: number,
): Span<Id>[] {
  const e = options.epsilon;
  const { height: h, width: w } = profile.body;
  const { bounds, colliders } = area;
  const solids = colliders.filter((c) => c.kind === "solid").map((c) => c.before);
  const hitbox = (x: number, y: number): Rect => ({ height: h, width: w, x, y: y - h });
  const levels: number[] = [];
  for (const top of colliders.map((c) => c.before.y).sort((a, b) => a - b)) {
    if (levels.length === 0 || top - levels[levels.length - 1]! > e) {
      levels.push(top);
    }
  }
  const result: Span<Id>[] = [];
  const low = bounds.x;
  const high = bounds.x + bounds.width - w;
  for (const y of levels) {
    const supports = colliders.filter((c) => Math.abs(c.before.y - y) <= e);
    const near = solids.filter((s) => s.y < y - e && s.y + s.height > y - h - rise + e);
    const marks = new Set([low, high]);
    for (const { before: s } of supports) {
      [s.x, s.x - w, s.x + s.width - w, s.x + s.width].forEach((m) => marks.add(m));
    }
    for (const s of near) {
      marks.add(s.x - w);
      marks.add(s.x + s.width);
    }
    const points = [...marks].filter((m) => m >= low && m <= high).sort((a, b) => a - b);
    const stand = (x: number): string | undefined => {
      const box = hitbox(x, y);
      if (
        box.x < bounds.x - e ||
        box.y < bounds.y - e ||
        box.x + w > bounds.x + bounds.width + e ||
        box.y + h > bounds.y + bounds.height + e ||
        solids.some((s) => overlaps(e, box, s))
      ) {
        return undefined;
      }
      const support = supportOf(e, supports, box);
      if (!support) {
        return undefined;
      }
      let ceiling = -Infinity;
      for (const s of near) {
        const bottom = s.y + s.height;
        if (bottom <= box.y + e && s.x < box.x + w - e && s.x + s.width > box.x + e) {
          ceiling = Math.max(ceiling, bottom);
        }
      }
      return `${colliders.indexOf(support)}|${ceiling}`;
    };
    const runs: { left: number; right: number; key: string }[] = [];
    let run: { left: number; right: number; key: string } | undefined;
    const visit = (key: string | undefined, left: number, right: number) => {
      if (key !== undefined && run?.key === key) {
        run.right = right;
        return;
      }
      if (run) {
        runs.push(run);
      }
      run = key === undefined ? undefined : { key, left, right };
    };
    points.forEach((p, i) => {
      visit(stand(p), p, p);
      const next = points[i + 1];
      if (next !== undefined) {
        visit(stand((p + next) / 2), p, next);
      }
    });
    visit(undefined, 0, 0);
    const stride = profile.walkSpeed * options.dtSeconds;
    for (const r of runs) {
      const supportId = colliders[Number(r.key.split("|")[0])]!.supportId;
      const samples: number[] = [];
      if (stride > 0) {
        for (let x = r.left; x < r.right - e; x += stride) {
          samples.push(x);
        }
      } else {
        samples.push(r.left);
      }
      samples.push(r.right);
      let start: number | undefined;
      let previous = r.left;
      const close = () => {
        if (start !== undefined) {
          result.push({ left: start, right: previous, supportId, y });
        }
      };
      for (const x of samples) {
        if (area.blocked(hitbox(x, y))) {
          close();
          start = undefined;
        } else if (start !== undefined && area.blocked(union(hitbox(previous, y), hitbox(x, y)))) {
          close();
          start = x;
        } else {
          start ??= x;
        }
        previous = x;
      }
      close();
    }
  }
  return result.sort((a, b) => a.y - b.y || a.left - b.left || a.right - b.right);
}

interface Candidate {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: MapEdgeKind;
  readonly launch: number;
  readonly land: number;
  readonly commands: readonly TraversalCommand[];
  readonly seconds: number;
  readonly sweep: Readonly<Rect>;
}
interface Leg<Id> {
  readonly to: MapNode<Id>;
  readonly state: TraversalState<Id>;
  readonly commands: readonly TraversalCommand[];
  readonly sweep: Readonly<Rect> | undefined;
}

/**
 * Bakes the static movement graph of one area for one profile. Spans are maximal hitbox-left ranges
 * per support with body-height headroom, split at blocked sweeps, ceiling changes within jump rise
 * and support changes; touching spans at one height are joined by `walk` edges. Edge witnesses run
 * through `options.step`. Work is counted in kernel steps in `work.steps`, at most `horizonSteps`
 * per leg; legs per node are at most 2 walks, 4 drops, L × S jumps and L × S × T × (S + 2) wall-top
 * legs, where L is the launch count, S the script count and T the higher nodes in reach.
 */
export function buildMovementMap<Id>(
  options: MapBuildOptions<Id>,
  profile: MovementProfile,
  area: MapArea<Id>,
): MovementMap<Id> {
  validateBuild(options, profile, area);
  const { dtSeconds: dt, epsilon: e, horizonSteps } = options;
  const { body } = profile;
  const { height: h, width: w } = body;
  const scripts = options.jumps ?? DEFAULT_JUMP_SCRIPTS;
  const step: MapStep<Id> = options.step ?? ((c, i, s) => stepTraversal(c, i, s));
  const rise = Math.max(
    ...[profile.jumpSpeed, ...scripts.map((s) => s.jumpSpeed ?? 0)].map(
      (v) => (v * v) / (2 * profile.gravity),
    ),
  );
  const reach = profile.walkSpeed * horizonSteps * dt;
  const hitbox = (x: number, y: number): Rect => ({ height: h, width: w, x, y: y - h });
  const spanRect = (s: Span<Id>): Rect => ({
    height: h,
    width: s.right - s.left + w,
    x: s.left,
    y: s.y - h,
  });
  const built = spans(options, profile, area, rise);
  const nodes: MapNode<Id>[] = built.map((s, i) => ({
    deps: area.deps(spanRect(s)),
    id: i as NodeId,
    kind: area.kind?.(s.supportId, spanRect(s)) ?? "static",
    left: s.left,
    right: s.right,
    supportId: s.supportId,
    y: s.y,
  }));
  const at = (x: number, y: number) =>
    nodes.find((n) => Math.abs(n.y - y) <= e && x >= n.left - e && x <= n.right + e);
  const geometry = { colliders: area.colliders, complete: true };
  const context = (jumpSpeed: number): TraversalContext<Id> => ({
    body,
    bounds: area.bounds,
    dtSeconds: dt,
    epsilon: e,
    maxCollisionSteps: options.maxCollisionSteps,
    maxDrop: area.bounds.height,
    profile: {
      gravity: profile.gravity,
      jumpSpeed,
      maxFallSpeed: profile.maxFallSpeed,
      walkSpeed: profile.walkSpeed,
    },
    safe: (request) => !area.blocked(union(request.from, request.to)),
    sampleColliders: () => geometry,
  });
  const base = context(profile.jumpSpeed);
  const work = { steps: 0 };
  const standing = (x: number, n: { y: number }): TraversalState<Id> => {
    const support = supportOf(e, area.colliders, hitbox(x, n.y))!;
    return {
      fallFromY: n.y,
      grounded: true,
      supportId: support.supportId,
      vy: 0,
      x: x - body.offset.x,
      y: n.y - h - body.offset.y,
    };
  };
  const run = (
    c: TraversalContext<Id>,
    mode: "drop" | "jump" | "walk",
    from: MapNode<Id>,
    start: TraversalState<Id>,
    startTick: number,
    policy: (tick: number, state: TraversalState<Id>) => TraversalCommand,
  ): Leg<Id> | undefined => {
    let state = start;
    let airborne = false;
    let sweep: Rect | undefined;
    const commands: TraversalCommand[] = [];
    for (let tick = 0; tick < horizonSteps; tick++) {
      const command = policy(tick, state);
      work.steps++;
      const input = {
        jump: command.jump,
        move: command.move,
        timeSeconds: (startTick + tick) * dt,
      };
      const result = step(c, input, state);
      if (result.status !== "ok") {
        return undefined;
      }
      commands.push({ jump: command.jump, move: command.move });
      for (const s of result.segments) {
        sweep = union(union(sweep, s.from), s.to);
      }
      const previousX = state.x;
      state = result.state;
      if (!state.grounded) {
        if (mode === "walk") {
          return undefined;
        }
        airborne = true;
        continue;
      }
      const node = at(state.x + body.offset.x, state.y + body.offset.y + h);
      if (!node) {
        return undefined;
      }
      if (airborne || node.id !== from.id) {
        // A drop that stays grounded onto another node is a walk, and a jump must leave the ground.
        return node.id === from.id || (!airborne && mode !== "walk")
          ? undefined
          : { commands, state, sweep, to: node };
      }
      if (mode === "jump" || state.x === previousX) {
        return undefined;
      }
    }
    return undefined;
  };
  const scriptPolicy = (
    script: MapJumpScript,
    target?: (x: number) => boolean,
  ): ((tick: number, state: TraversalState<Id>) => TraversalCommand) => {
    let apex = false;
    let stopped = false;
    const lead = script.lead ?? [];
    return (tick, state) => {
      apex ||= !state.grounded && state.vy >= 0;
      stopped ||= target?.(state.x + body.offset.x) ?? false;
      const command =
        tick < lead.length
          ? lead[tick]!
          : apex && script.afterApex
            ? script.afterApex
            : script.hold;
      return stopped ? { jump: command.jump, move: 0 } : command;
    };
  };
  const candidates: Candidate[] = [];
  const add = (kind: MapEdgeKind, from: MapNode<Id>, launch: number, legs: readonly Leg<Id>[]) => {
    const last = legs[legs.length - 1]!;
    const commands = legs.flatMap((l) => l.commands);
    let sweep: Rect | undefined;
    for (const l of legs) {
      if (l.sweep) {
        sweep = union(sweep, l.sweep);
      }
    }
    candidates.push({
      commands,
      from: from.id,
      kind,
      land: last.state.x + body.offset.x,
      launch,
      seconds: commands.length * dt,
      sweep: sweep ?? hitbox(launch, from.y),
      to: last.to.id,
    });
  };
  const launches = (n: MapNode<Id>) => {
    const xs = [n.left];
    for (let x = n.left + options.launchStride; x < n.right - e; x += options.launchStride) {
      xs.push(x);
    }
    if (n.right > n.left) {
      xs.push(n.right);
    }
    return xs;
  };
  const ahead = (d: number, x: number, n: MapNode<Id>) =>
    d > 0
      ? n.right >= x - e && n.left <= x + reach + e
      : d < 0
        ? n.left <= x + e && n.right >= x - reach - e
        : n.left <= x + e && n.right >= x - e;
  for (const from of nodes) {
    // Walks across a seam with a touching span at the same height.
    for (const [d, x] of [
      [1, from.right],
      [-1, from.left],
    ] as const) {
      const touching = nodes.some(
        (n) =>
          n !== from &&
          Math.abs(n.y - from.y) <= e &&
          Math.abs((d > 0 ? n.left : n.right) - x) <= e,
      );
      if (touching) {
        const leg = run(base, "walk", from, standing(x, from), 0, () => ({ jump: false, move: d }));
        if (leg) {
          add("walk", from, x, [leg]);
        }
      }
    }
    // Drops off each end with move held and with move released once airborne.
    for (const [d, x] of [
      [1, from.right],
      [-1, from.left],
    ] as const) {
      if (!nodes.some((n) => n.y > from.y + e && (d > 0 ? n.right + w > x : n.left < x + w))) {
        continue;
      }
      for (const release of [false, true]) {
        const leg = run(base, "drop", from, standing(x, from), 0, (_, s) => ({
          jump: false,
          move: release && !s.grounded ? 0 : d,
        }));
        if (leg) {
          add("drop", from, x, [leg]);
        }
      }
    }
    const xs = launches(from);
    const inReach = (n: MapNode<Id>) => n !== from && n.y >= from.y - rise - e;
    for (const x of xs) {
      for (const script of scripts) {
        const d = script.hold.move;
        if (!nodes.some((n) => inReach(n) && ahead(d, x, n))) {
          continue;
        }
        const c = script.jumpSpeed === undefined ? base : context(script.jumpSpeed);
        const leg = run(c, "jump", from, standing(x, from), 0, scriptPolicy(script));
        if (leg) {
          add("jump", from, x, [leg]);
        }
      }
      // Wall tops: steer onto a higher node, stop over it, then continue the same way.
      for (const script of scripts) {
        const d = script.hold.move;
        if (d === 0) {
          continue;
        }
        const c = script.jumpSpeed === undefined ? base : context(script.jumpSpeed);
        for (const top of nodes) {
          if (!(inReach(top) && top.y < from.y - e && ahead(d, x, top))) {
            continue;
          }
          const over = (bx: number) => (d > 0 ? bx >= top.left - e : bx <= top.right + e);
          const first = run(c, "jump", from, standing(x, from), 0, scriptPolicy(script, over));
          if (first?.to !== top) {
            continue;
          }
          const tick = first.commands.length;
          const onward: Leg<Id>[] = [];
          for (const next of scripts) {
            if (next.hold.move === d) {
              const cn = next.jumpSpeed === undefined ? base : context(next.jumpSpeed);
              const leg = run(cn, "jump", top, first.state, tick, scriptPolicy(next));
              if (leg) {
                onward.push(leg);
              }
            }
          }
          const fall = run(base, "drop", top, first.state, tick, () => ({ jump: false, move: d }));
          if (fall) {
            onward.push(fall);
          }
          for (const leg of onward) {
            if (leg.to !== from) {
              add("wall-top", from, x, [first, leg]);
            }
          }
        }
      }
    }
    // Climbs through a clear column onto a support top within the climb height.
    if (profile.climb) {
      const { height: climbHeight, speed } = profile.climb;
      for (const top of nodes) {
        const height = from.y - top.y;
        const left = Math.max(from.left, top.left);
        const right = Math.min(from.right, top.right);
        if (height <= e || height > climbHeight + e || left > right + e) {
          continue;
        }
        const columns = [left];
        for (let x = left + options.launchStride; x < right - e; x += options.launchStride) {
          columns.push(x);
        }
        columns.push(right);
        for (const x of columns) {
          const column: Rect = { height: height + h, width: w, x, y: top.y - h };
          if (
            area.colliders.some((c) => c.kind === "solid" && overlaps(e, column, c.before)) ||
            area.blocked(column)
          ) {
            continue;
          }
          candidates.push({
            commands: [],
            from: from.id,
            kind: "climb",
            land: x,
            launch: x,
            seconds: height / speed,
            sweep: column,
            to: top.id,
          });
          break;
        }
      }
    }
  }
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.from}|${c.to}|${c.kind}|${commandCode(c.commands)}`;
    const group = groups.get(key);
    if (group) {
      group.push(c);
    } else {
      groups.set(key, [c]);
    }
  }
  const merged = [...groups.values()].map((group) => {
    const first = group[0]!;
    let sweep: Rect | undefined;
    for (const c of group) {
      sweep = union(sweep, c.sweep);
    }
    return {
      code: commandCode(first.commands),
      commands: first.commands,
      from: first.from,
      kind: first.kind,
      land: {
        left: Math.min(...group.map((c) => c.land)),
        right: Math.max(...group.map((c) => c.land)),
      },
      launch: {
        left: Math.min(...group.map((c) => c.launch)),
        right: Math.max(...group.map((c) => c.launch)),
      },
      seconds: first.seconds,
      sweep: sweep!,
      to: first.to,
    };
  });
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  merged.sort(
    (a, b) =>
      a.from - b.from ||
      a.to - b.to ||
      text(a.kind, b.kind) ||
      a.launch.left - b.launch.left ||
      a.launch.right - b.launch.right ||
      a.land.left - b.land.left ||
      a.land.right - b.land.right ||
      text(a.code, b.code),
  );
  const edges: MapEdge<Id>[] = merged.map((m, i) => ({
    commands: m.commands,
    deps: area.deps(m.sweep),
    from: m.from,
    id: i as EdgeId,
    kind: m.kind,
    land: m.land,
    launch: m.launch,
    seconds: m.seconds,
    sweep: m.sweep,
    to: m.to,
  }));
  const outgoing: EdgeId[][] = nodes.map(() => []);
  for (const edge of edges) {
    outgoing[edge.from]!.push(edge.id);
  }
  return {
    edges,
    nodes,
    options: {
      dtSeconds: dt,
      epsilon: e,
      horizonSteps,
      jumps: scripts,
      launchStride: options.launchStride,
      maxCollisionSteps: options.maxCollisionSteps,
    },
    outgoing,
    profile,
    work: { steps: work.steps },
  };
}

// The node whose span holds the body's hitbox (bottom on the support top, left x in range); the
// lowest id wins where spans share a seam.
export function locate<Id>(map: MovementMap<Id>, body: Readonly<Rect>): NodeRef | undefined {
  const e = map.options.epsilon;
  const bottom = body.y + body.height;
  const node = map.nodes.find(
    (n) => Math.abs(n.y - bottom) <= e && body.x >= n.left - e && body.x <= n.right + e,
  );
  return node && { node: node.id, x: clamp(node.left, node.right, body.x) };
}

interface Arrival {
  readonly seconds: number;
  readonly node: NodeId;
  readonly x: number;
  readonly edge: EdgeId | -1;
  readonly previous: Arrival | undefined;
}
function before(a: Arrival, b: Arrival): boolean {
  return (a.seconds - b.seconds || a.node - b.node || a.edge - b.edge) < 0;
}
function push(heap: Arrival[], item: Arrival): void {
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
}
function pop(heap: Arrival[]): Arrival {
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
}

// Dijkstra on seconds: edge seconds plus walking within a node from the arrival x to the launch
// range at walkSpeed. Each edge settles once, at its earliest arrival; ties go to the lower node id,
// then edge id. Returns the first arrival per node, or the arrival that satisfied `stop`.
function search<Id>(
  map: MovementMap<Id>,
  mask: MapMask,
  from: NodeRef,
  startSeconds: number,
  stop: ((node: MapNode<Id>) => boolean) | undefined,
): { readonly first: Map<NodeId, Arrival>; readonly found: Arrival | undefined } {
  const first = new Map<NodeId, Arrival>();
  if (!map.nodes[from.node] || !Number.isFinite(from.x)) {
    throw new RangeError("Unknown movement map node");
  }
  if (!mask.node(from.node)) {
    return { first, found: undefined };
  }
  const settled = new Set<number>();
  const heap: Arrival[] = [];
  push(heap, { edge: -1, node: from.node, previous: undefined, seconds: startSeconds, x: from.x });
  while (heap.length) {
    const arrival = pop(heap);
    if (settled.has(arrival.edge)) {
      continue;
    }
    settled.add(arrival.edge);
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
}

function distanceTo<Id>(map: MovementMap<Id>, point: Point, node: MapNode<Id>): number {
  const half = map.profile.body.width / 2;
  const dx = Math.max(0, node.left + half - point.x, point.x - node.right - half);
  return Math.hypot(dx, point.y - node.y);
}

// The fastest path under the mask, from a node position to the first node meeting the goal. A
// `point` goal accepts a node whose hitbox bottom-centre range lies within `radius` of the point.
export function pathTo<Id>(
  map: MovementMap<Id>,
  mask: MapMask,
  from: NodeRef,
  goal: MapGoal<Id>,
): MapPath | undefined {
  const test =
    "node" in goal
      ? (n: MapNode<Id>) => n.id === goal.node
      : "point" in goal
        ? (n: MapNode<Id>) => distanceTo(map, goal.point, n) <= goal.radius
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
}

// Every node reachable under the mask, in id order.
export function reachableSet<Id>(
  map: MovementMap<Id>,
  mask: MapMask,
  from: NodeRef,
): ReadonlySet<NodeId> {
  const { first } = search(map, mask, from, 0, undefined);
  return new Set([...first.keys()].sort((a, b) => a - b));
}

// The reachable position nearest the point (hitbox bottom-centre distance), then the earliest
// arrival, then the lowest node id.
export function nearestReachable<Id>(
  map: MovementMap<Id>,
  mask: MapMask,
  from: NodeRef,
  toward: Point,
): NodeRef | undefined {
  const { first } = search(map, mask, from, 0, undefined);
  let best: { node: MapNode<Id>; distance: number; seconds: number } | undefined;
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
}

// Reachable nodes from which no exit is reachable when leaving at the earliest arrival, in id order.
export function sinks<Id>(
  map: MovementMap<Id>,
  mask: MapMask,
  from: NodeRef,
  exits: readonly NodeId[],
): readonly NodeId[] {
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
}

const rectText = (rect: Readonly<Rect>) => `${rect.x},${rect.y},${rect.width},${rect.height}`;
const scriptText = (script: MapJumpScript) =>
  [
    commandCode(script.lead ?? []),
    commandCode([script.hold]),
    script.afterApex ? commandCode([script.afterApex]) : "-",
    script.jumpSpeed ?? "-",
  ].join("/");

// The canonical form, one line per entry joined by "\n", numbers in JavaScript's shortest
// round-trip form, caller ids (support ids and deps) as depKey values, deps joined by "," in the
// area's order, and commands one character each (l, s or r for move -1, 0 or 1, upper case when
// jump is true). A jump script is <lead>/<hold>/<afterApex or ->/<jumpSpeed or ->; scripts and
// ranges are joined by ",". The caller's step is not part of the form.
//   movement-map 1
//   options <dtSeconds> <epsilon> <horizonSteps> <launchStride> <maxCollisionSteps> <scripts>
//   profile <width>,<height>,<offset x>,<offset y> <walkSpeed> <gravity> <jumpSpeed>
//     <maxFallSpeed> <climb height>,<climb speed or -,->
//   node <id> <kind> <y> <left>,<right> <support> <deps>                       (in id order)
//   edge <id> <from> <to> <kind> <launch left>,<right> <land left>,<right> <seconds> <sweep>
//     <deps> <commands>                                                       (in id order)
// The profile and edge lines are single lines; they wrap here only for width.
export function mapCanonical<Id>(depKey: (id: Id) => string, map: MovementMap<Id>): string {
  const deps = (ids: readonly Id[]) => ids.map(depKey).join(",");
  const { options: o, profile: p } = map;
  const { body } = p;
  const climb = p.climb ? `${p.climb.height},${p.climb.speed}` : "-,-";
  const lines = [
    "movement-map 1",
    `options ${o.dtSeconds} ${o.epsilon} ${o.horizonSteps} ${o.launchStride} ` +
      `${o.maxCollisionSteps} ${o.jumps.map(scriptText).join(",")}`,
    `profile ${body.width},${body.height},${body.offset.x},${body.offset.y} ${p.walkSpeed} ` +
      `${p.gravity} ${p.jumpSpeed} ${p.maxFallSpeed} ${climb}`,
    ...map.nodes.map(
      (n) =>
        `node ${n.id} ${n.kind} ${n.y} ${n.left},${n.right} ${depKey(n.supportId)} ${deps(n.deps)}`,
    ),
    ...map.edges.map(
      (edge) =>
        `edge ${edge.id} ${edge.from} ${edge.to} ${edge.kind} ` +
        `${edge.launch.left},${edge.launch.right} ${edge.land.left},${edge.land.right} ` +
        `${edge.seconds} ${rectText(edge.sweep)} ${deps(edge.deps)} ${commandCode(edge.commands)}`,
    ),
  ];
  return lines.join("\n");
}

// FNV-1a 64 of mapCanonical, as 16 lowercase hex digits.
export function mapHash<Id>(depKey: (id: Id) => string, map: MovementMap<Id>): string {
  return fnv1a64(mapCanonical(depKey, map));
}
