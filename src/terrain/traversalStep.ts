// The fixed-step traversal kernel shared by `traversal` and `movementMap`. Not a package export:
// `stepTraversal` validates every call's geometry, and `stepStaticTraversal` serves a builder that
// validated its static geometry once.
import type { Rect } from "../rect.ts";
import type {
  TraversalCollider,
  TraversalContext,
  TraversalGeometry,
  TraversalInput,
  TraversalMotionSegment,
  TraversalSafety,
  TraversalState,
  TraversalStepResult,
} from "./traversal.ts";

export function validRect(rect: Readonly<Rect>): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}
export function box<Id>(
  context: Pick<TraversalContext<Id>, "body">,
  state: TraversalState<Id>,
): Rect {
  return {
    height: context.body.height,
    width: context.body.width,
    x: state.x + context.body.offset.x,
    y: state.y + context.body.offset.y,
  };
}
export function inside(outer: Readonly<Rect>, inner: Readonly<Rect>, epsilon: number): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}
export function overlaps(a: Readonly<Rect>, b: Readonly<Rect>, epsilon: number): boolean {
  return (
    a.x < b.x + b.width - epsilon &&
    b.x < a.x + a.width - epsilon &&
    a.y < b.y + b.height - epsilon &&
    b.y < a.y + a.height - epsilon
  );
}
const finite = Number.isFinite;
const positive = (v: number) => Number.isFinite(v) && v > 0;
const nonNegative = (v: number) => Number.isFinite(v) && v >= 0;
export function validate<Id>(
  context: Omit<TraversalContext<Id>, "sampleColliders" | "safe">,
  state: TraversalState<Id>,
  time: number,
): void {
  const { body, profile } = context;
  if (
    !validRect(context.bounds) ||
    !validRect(box(context, state)) ||
    !finite(state.vy) ||
    !finite(state.fallFromY) ||
    !finite(time) ||
    !finite(body.offset.x) ||
    !finite(body.offset.y) ||
    !positive(context.dtSeconds) ||
    !positive(profile.gravity) ||
    !positive(profile.maxFallSpeed) ||
    !nonNegative(context.epsilon) ||
    !nonNegative(context.maxDrop) ||
    !nonNegative(profile.walkSpeed) ||
    !nonNegative(profile.jumpSpeed) ||
    !Number.isSafeInteger(context.maxCollisionSteps) ||
    context.maxCollisionSteps < 1 ||
    !Number.isFinite(time + context.dtSeconds)
  ) {
    throw new RangeError("Invalid traversal configuration or state");
  }
}
function motions<Id>(
  time: number,
  dt: number,
  collider: TraversalCollider<Id>,
): readonly TraversalMotionSegment[] {
  return (
    collider.segments ?? [
      { endSeconds: time + dt, from: collider.before, startSeconds: time, to: collider.after },
    ]
  );
}
function same(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
export function validGeometry<Id>(
  time: number,
  dt: number,
  geometry: TraversalGeometry<Id>,
): boolean {
  if (!geometry.complete) {
    return false;
  }
  const ids = new Set<Id>();
  for (const c of geometry.colliders) {
    if (
      ids.has(c.supportId) ||
      (c.kind !== "solid" && c.kind !== "ledge") ||
      !validRect(c.before) ||
      !validRect(c.after)
    ) {
      return false;
    }
    ids.add(c.supportId);
    if (!c.segments) {
      // The implicit single segment from before to after, checked without allocating it.
      if (
        !Number.isFinite(time + dt) ||
        time + dt <= time ||
        c.after.width !== c.before.width ||
        c.after.height !== c.before.height
      ) {
        return false;
      }
      continue;
    }
    let previous = c.before;
    let at = time;
    for (const s of c.segments) {
      if (
        s.startSeconds !== at ||
        !Number.isFinite(s.endSeconds) ||
        s.endSeconds <= at ||
        !same(previous, s.from) ||
        !validRect(s.to) ||
        s.to.width !== c.before.width ||
        s.to.height !== c.before.height
      ) {
        return false;
      }
      at = s.endSeconds;
      previous = s.to;
    }
    if (at !== time + dt || !same(previous, c.after)) {
      return false;
    }
  }
  return true;
}
function atTime<Id>(
  time: number,
  dt: number,
  collider: TraversalCollider<Id>,
  at: number,
): Readonly<Rect> {
  const list = collider.segments;
  // Validated geometry has a positive span, so interpolation would reproduce the box.
  if (!list && same(collider.before, collider.after)) {
    return collider.before;
  }
  let start = time;
  let end = time + dt;
  let from = collider.before;
  let to = collider.after;
  if (list) {
    const segment = list.find((s) => at < s.endSeconds) ?? list[list.length - 1]!;
    start = segment.startSeconds;
    end = segment.endSeconds;
    from = segment.from;
    to = segment.to;
  }
  const fraction = Math.max(0, Math.min(1, (at - start) / (end - start)));
  return {
    ...from,
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  };
}
// Reused by `supports`, which calls no callbacks and empties it on entry and before returning.
const touching: TraversalCollider<unknown>[] = [];
export function supports<Id>(
  epsilon: number,
  rect: Readonly<Rect>,
  colliders: readonly TraversalCollider<Id>[],
  endpoint: "before" | "after",
): TraversalCollider<Id> | undefined {
  const at = (c: TraversalCollider<Id>) => (endpoint === "before" ? c.before : c.after);
  const touches = (r: Readonly<Rect>) =>
    Math.abs(r.y - rect.y - rect.height) <= epsilon &&
    r.x < rect.x + rect.width &&
    r.x + r.width > rect.x;
  let only: TraversalCollider<Id> | undefined;
  let count = 0;
  for (const c of colliders) {
    if (touches(at(c))) {
      only = c;
      if (++count > 1) {
        break;
      }
    }
  }
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    // The general rule below for one candidate, whose motion differs from its own only when NaN.
    const r = at(only!);
    const edge = Math.max(rect.x, r.x + r.width);
    return r.x > rect.x + epsilon ||
      !(edge >= rect.x + rect.width - epsilon) ||
      Number.isNaN(only!.after.x - only!.before.x) ||
      Number.isNaN(only!.after.y - only!.before.y)
      ? undefined
      : only;
  }
  // The touching colliders, stably sorted by left edge.
  const candidates = touching as TraversalCollider<Id>[];
  candidates.length = 0;
  for (const c of colliders) {
    const r = c[endpoint];
    if (touches(r)) {
      let i = candidates.length;
      while (i > 0 && candidates[i - 1]![endpoint].x - r.x > 0) {
        candidates[i] = candidates[i - 1]!;
        i--;
      }
      candidates[i] = c;
    }
  }
  let found: TraversalCollider<Id> | undefined;
  let edge = rect.x;
  for (const c of candidates) {
    if (c[endpoint].x > edge + epsilon) {
      break;
    }
    edge = Math.max(edge, c[endpoint].x + c[endpoint].width);
    if (edge >= rect.x + rect.width - epsilon) {
      const first = candidates[0]!;
      const dx = first.after.x - first.before.x;
      const dy = first.after.y - first.before.y;
      found = first;
      for (const other of candidates) {
        if (other.after.x - other.before.x !== dx || other.after.y - other.before.y !== dy) {
          found = undefined;
          break;
        }
      }
      break;
    }
  }
  candidates.length = 0;
  return found;
}
// Fractions of a relative move at which one axis interval starts and stops overlapping.
function slabEnter(
  epsilon: number,
  from: number,
  length: number,
  start: number,
  size: number,
  delta: number,
): number {
  return delta === 0
    ? from < start + size - epsilon && from + length > start + epsilon
      ? -Infinity
      : Infinity
    : delta > 0
      ? (start - from - length) / delta
      : (start + size - from) / delta;
}
function slabExit(
  epsilon: number,
  from: number,
  length: number,
  start: number,
  size: number,
  delta: number,
): number {
  return delta === 0
    ? from < start + size - epsilon && from + length > start + epsilon
      ? Infinity
      : -Infinity
    : delta > 0
      ? (start + size - from) / delta
      : (start - from - length) / delta;
}
interface Hit {
  readonly fraction: number;
  readonly axis: "x" | "y";
  readonly velocity: number;
}
function hit(
  epsilon: number,
  body: Readonly<Rect>,
  solid: Readonly<Rect>,
  dx: number,
  dy: number,
  sx: number,
  sy: number,
  seconds: number,
  kind: "solid" | "ledge",
): Hit | undefined {
  const rx = dx - sx;
  const ry = dy - sy;
  if (kind === "ledge") {
    if (ry <= 0 || body.y + body.height > solid.y + epsilon) {
      return undefined;
    }
    const t = (solid.y - body.y - body.height) / ry;
    const x = body.x + rx * t;
    return t >= -epsilon &&
      t <= 1 &&
      x < solid.x + solid.width - epsilon &&
      x + body.width > solid.x + epsilon
      ? { axis: "y", fraction: Math.max(0, t), velocity: sy / seconds }
      : undefined;
  }
  const x0 = slabEnter(epsilon, body.x, body.width, solid.x, solid.width, rx);
  const x1 = slabExit(epsilon, body.x, body.width, solid.x, solid.width, rx);
  const y0 = slabEnter(epsilon, body.y, body.height, solid.y, solid.height, ry);
  const y1 = slabExit(epsilon, body.y, body.height, solid.y, solid.height, ry);
  const enter = Math.max(x0, y0);
  if (enter < -epsilon || enter > 1 || enter >= Math.min(x1, y1) || Math.min(x1, y1) < 0) {
    return undefined;
  }
  const axis = x0 > y0 ? "x" : "y";
  return { axis, fraction: Math.max(0, enter), velocity: (axis === "x" ? sx : sy) / seconds };
}

// Whether a step validates each sampled geometry, or relies on geometry its caller validated:
// complete, unique ids, solid or ledge kinds and valid static rects without segments. Such a
// sample still fails, as validation would, when the step's clock span is not positive.
type Checks = "validate" | "static";
function sampledValid<Id>(
  checks: Checks,
  time: number,
  dt: number,
  geometry: TraversalGeometry<Id>,
): boolean {
  return checks === "validate"
    ? validGeometry(time, dt, geometry)
    : geometry.colliders.length === 0 || (Number.isFinite(time + dt) && time + dt > time);
}

// The part of a step that depends only on the context, state and clock.
type StepStart<Id> =
  | { readonly status: "out-of-bounds" | "geometry-unavailable" }
  | {
      readonly status: "ok";
      readonly body: Readonly<Rect>;
      readonly colliders: readonly TraversalCollider<Id>[];
      readonly carrier: TraversalCollider<Id> | undefined;
    };
const OUT_OF_BOUNDS = { status: "out-of-bounds" } as const;
const NO_COLLIDERS: readonly never[] = [];
const UNAVAILABLE = { status: "geometry-unavailable" } as const;
function startStep<Id>(
  checks: Checks,
  context: TraversalContext<Id>,
  time: number,
  state: TraversalState<Id>,
): StepStart<Id> {
  const { dtSeconds: dt, epsilon: e } = context;
  const body = box(context, state);
  if (!inside(context.bounds, body, e)) {
    return OUT_OF_BOUNDS;
  }
  const first = context.sampleColliders(time, dt, body);
  if (!sampledValid(checks, time, dt, first)) {
    return UNAVAILABLE;
  }
  const supported = state.grounded ? supports(e, body, first.colliders, "before") : undefined;
  let carrier: TraversalCollider<Id> | undefined;
  if (supported) {
    for (const c of first.colliders) {
      if (
        c.supportId === state.supportId &&
        Math.abs(c.before.y - body.y - body.height) <= e &&
        c.before.x < body.x + body.width &&
        c.before.x + c.before.width > body.x
      ) {
        carrier = c;
        break;
      }
    }
    carrier ??= supported;
  }
  return { body, carrier, colliders: first.colliders, status: "ok" };
}
function validInput(input: TraversalInput): void {
  if (input.move !== -1 && input.move !== 0 && input.move !== 1) {
    throw new RangeError("Invalid traversal input");
  }
}

// Every search edge and runtime move executes this same atomic fixed step.
export function stepKernel<Id>(
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
): TraversalStepResult<Id> {
  validate(context, state, input.timeSeconds);
  validInput(input);
  return advanceStep(
    "validate",
    context,
    startStep("validate", context, input.timeSeconds, state),
    input,
    state,
  );
}

// The same step over static geometry the caller validated once with `validGeometry`: every
// sample is a subset of it, complete, with every collider's `before` equal to its `after`.
export function stepStaticTraversal<Id>(
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
): TraversalStepResult<Id> {
  validate(context, state, input.timeSeconds);
  validInput(input);
  return advanceStep(
    "static",
    context,
    startStep("static", context, input.timeSeconds, state),
    input,
    state,
  );
}

// Steps sibling inputs that share one state and clock, starting the step once on first use.
export function siblingSteps<Id>(
  context: TraversalContext<Id>,
  state: TraversalState<Id>,
): (input: TraversalInput) => TraversalStepResult<Id> {
  let start: StepStart<Id> | undefined;
  return (input) => {
    if (!start) {
      validate(context, state, input.timeSeconds);
    }
    validInput(input);
    start ??= startStep("validate", context, input.timeSeconds, state);
    return advanceStep("validate", context, start, input, state);
  };
}

function failed<Id>(
  status: TraversalStepResult<Id>["status"],
  state: TraversalState<Id>,
): TraversalStepResult<Id> {
  return { segments: [], state, status };
}
function solidOverlap<Id>(
  epsilon: number,
  body: Readonly<Rect>,
  colliders: readonly TraversalCollider<Id>[],
  endpoint: "before" | "after",
): boolean {
  for (const c of colliders) {
    if (c.kind === "solid" && overlaps(body, c[endpoint], epsilon)) {
      return true;
    }
  }
  return false;
}

function advanceStep<Id>(
  checks: Checks,
  context: TraversalContext<Id>,
  start: StepStart<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
): TraversalStepResult<Id> {
  if (start.status !== "ok") {
    return failed(start.status, state);
  }
  const { dtSeconds: dt, epsilon: e } = context;
  const time = input.timeSeconds;
  const { carrier } = start;
  let body = start.body;
  let vy = Math.min(
    context.profile.maxFallSpeed,
    (input.jump && carrier ? -context.profile.jumpSpeed : carrier ? 0 : state.vy) +
      context.profile.gravity * dt,
  );
  const vx = input.move * context.profile.walkSpeed;
  // Include every intermediate carrier extremum, not only its endpoint delta.
  let lowX = 0;
  let highX = 0;
  let lowY = 0;
  let highY = 0;
  if (carrier) {
    const shift = (p: Readonly<Rect>) => {
      lowX = Math.min(lowX, p.x - carrier.before.x);
      highX = Math.max(highX, p.x - carrier.before.x);
      lowY = Math.min(lowY, p.y - carrier.before.y);
      highY = Math.max(highY, p.y - carrier.before.y);
    };
    if (carrier.segments) {
      for (const s of carrier.segments) {
        shift(s.from);
        shift(s.to);
      }
    } else {
      shift(carrier.before);
      shift(carrier.after);
    }
  }
  const x0 = Math.min(0, vx * dt) + lowX;
  const y0 = Math.min(0, vy * dt) + lowY;
  const query = {
    height: body.height + Math.max(0, vy * dt) + highY - y0 + 2 * e,
    width: body.width + Math.max(0, vx * dt) + highX - x0 + 2 * e,
    x: body.x + x0 - e,
    y: body.y + y0 - e,
  };
  // Incoming movers can push beyond locomotion bounds. Include their swept extents;
  // a later push outside this sampled domain is unknown rather than collision-free.
  for (const c of checks === "static" ? NO_COLLIDERS : start.colliders) {
    if (same(c.before, c.after) && !c.segments) {
      continue;
    }
    for (const segment of motions(time, dt, c)) {
      for (const r of [segment.from, segment.to]) {
        const left = Math.min(query.x, r.x - body.width - e);
        const top = Math.min(query.y, r.y - body.height - e);
        query.width = Math.max(query.x + query.width, r.x + r.width + body.width + e) - left;
        query.height = Math.max(query.y + query.height, r.y + r.height + body.height + e) - top;
        query.x = left;
        query.y = top;
      }
    }
  }
  if (!validRect(query)) {
    return failed("geometry-unavailable", state);
  }
  const geometry = context.sampleColliders(time, dt, query);
  if (!sampledValid(checks, time, dt, geometry)) {
    return failed("geometry-unavailable", state);
  }
  const colliders = geometry.colliders;
  if (carrier) {
    let present = false;
    for (const c of colliders) {
      if (
        c.supportId === carrier.supportId &&
        same(c.before, carrier.before) &&
        same(c.after, carrier.after)
      ) {
        present = true;
        break;
      }
    }
    if (!present) {
      return failed("geometry-unavailable", state);
    }
  }
  if (solidOverlap(e, body, colliders, "before")) {
    return failed("blocked", state);
  }
  // Allocate the set and sort only when a segment adds another boundary value.
  const stepEnd = time + dt;
  let boundaries: Set<number> | undefined;
  for (const collider of checks === "static" ? NO_COLLIDERS : colliders) {
    if (collider.segments) {
      for (const segment of collider.segments) {
        if (segment.startSeconds !== time && segment.startSeconds !== stepEnd) {
          boundaries ??= new Set([time, stepEnd]);
          boundaries.add(segment.startSeconds);
        }
        if (segment.endSeconds !== time && segment.endSeconds !== stepEnd) {
          boundaries ??= new Set([time, stepEnd]);
          boundaries.add(segment.endSeconds);
        }
      }
    }
  }
  // Set normalizes signed zero and deduplicates clocks whose addition collapses.
  const startBoundary = time === 0 ? 0 : time;
  const endBoundary = stepEnd === 0 ? 0 : stepEnd;
  // Without segment boundaries the clocks are the step's two ends, read without an array.
  const sorted = boundaries ? [...boundaries].sort((a, b) => a - b) : undefined;
  const count = sorted ? sorted.length : startBoundary === endBoundary ? 1 : 2;
  const clock = (i: number) => (sorted ? sorted[i]! : i === 0 ? startBoundary : endBoundary);
  const segments: TraversalSafety[] = [];
  let iterations = 0;
  let fallFromY = carrier ? body.y + body.height : state.fallFromY;
  for (let i = 1; i < count; i++) {
    let now = clock(i - 1);
    const end = clock(i);
    const carried = carrier && !input.jump ? carrier : undefined;
    const a = carried ? atTime(time, dt, carried, now) : undefined;
    const b = carried ? atTime(time, dt, carried, end) : undefined;
    let movingX = vx + (a && b ? (b.x - a.x) / (end - now) : 0);
    let movingY = vy + (a && b ? (b.y - a.y) / (end - now) : 0);
    // The axes already constrained at the clock `constrainedAt`.
    let constrainedAt = -Infinity;
    let constrainedX = false;
    let constrainedY = false;
    while (now < end) {
      if (++iterations > context.maxCollisionSteps) {
        return failed("budget-exhausted", state);
      }
      const seconds = end - now;
      let nearest: Hit | undefined;
      // A static box farther from the body than its move, widened by epsilon, cannot be hit: its
      // entry fraction exceeds 1, its exit precedes 0, or a ledge's contact fraction lies outside
      // [-epsilon, 1].
      const reachX = Math.abs(movingX * seconds) * (1 + e) + e;
      const reachY = Math.abs(movingY * seconds) * (1 + e) + e;
      for (const c of colliders) {
        if (
          checks === "static" &&
          (c.before.x > body.x + body.width + reachX ||
            c.before.x + c.before.width < body.x - reachX ||
            c.before.y > body.y + body.height + reachY ||
            c.before.y + c.before.height < body.y - reachY)
        ) {
          continue;
        }
        // A static collider's box at any clock is its `before`.
        const from = checks === "static" ? c.before : atTime(time, dt, c, now);
        const to = checks === "static" ? from : atTime(time, dt, c, end);
        const contact = hit(
          e,
          body,
          from,
          movingX * seconds,
          movingY * seconds,
          to.x - from.x,
          to.y - from.y,
          seconds,
          c.kind,
        );
        if (contact && (!nearest || contact.fraction < nearest.fraction)) {
          nearest = contact;
        }
      }
      const fraction = nearest?.fraction ?? 1;
      const arrival = fraction === 1 ? end : now + seconds * fraction;
      const next = {
        height: body.height,
        width: body.width,
        x: body.x + movingX * seconds * fraction,
        y: body.y + movingY * seconds * fraction,
      };
      const segment: TraversalSafety = {
        endSeconds: arrival,
        from: body,
        phase: "sweep",
        startSeconds: now,
        to: next,
      };
      if (!inside(context.bounds, next, e)) {
        return failed("out-of-bounds", state);
      }
      if (!inside(query, next, e)) {
        return failed("geometry-unavailable", state);
      }
      fallFromY = Math.min(fallFromY, next.y + next.height);
      if (next.y + next.height - fallFromY > context.maxDrop + e || !context.safe(segment)) {
        return failed("unsafe", state);
      }
      segments.push(segment);
      body = next;
      now = arrival;
      if (nearest) {
        if (constrainedAt !== now) {
          constrainedX = false;
          constrainedY = false;
          constrainedAt = now;
        }
        if (nearest.axis === "x" ? constrainedX : constrainedY) {
          return failed("blocked", state);
        }
        if (nearest.axis === "x") {
          constrainedX = true;
          movingX = nearest.velocity;
        } else {
          constrainedY = true;
          movingY = nearest.velocity;
          vy = 0;
        }
      }
      for (const c of colliders) {
        if (
          c.kind === "solid" &&
          overlaps(body, checks === "static" ? c.before : atTime(time, dt, c, now), e)
        ) {
          return failed("blocked", state);
        }
      }
    }
  }
  const support = vy >= 0 ? supports(e, body, colliders, "after") : undefined;
  // Static boxes do not move, so the sweep's last check already cleared the end body.
  if (checks === "validate" && solidOverlap(e, body, colliders, "after")) {
    return failed("blocked", state);
  }
  if (support) {
    const landing: TraversalSafety = {
      endSeconds: time + dt,
      from: body,
      phase: "landing",
      startSeconds: time + dt,
      to: body,
    };
    if (!context.safe(landing)) {
      return failed("unsafe", state);
    }
    segments.push(landing);
    fallFromY = body.y + body.height;
  }
  /* eslint-disable sort-keys -- Preserve the public state's existing property order. */
  return {
    segments,
    state: support
      ? {
          grounded: true,
          vy: 0,
          x: body.x - context.body.offset.x,
          y: body.y - context.body.offset.y,
          supportId: support.supportId,
          fallFromY,
        }
      : {
          grounded: false,
          vy,
          x: body.x - context.body.offset.x,
          y: body.y - context.body.offset.y,
          fallFromY,
        },
    status: "ok",
  };
  /* eslint-enable sort-keys */
}
