import type { Point, Rect } from "../rect.ts";

export interface TraversalMotionSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly from: Readonly<Rect>;
  readonly to: Readonly<Rect>;
}
export interface TraversalCollider<Id> {
  readonly supportId: Id;
  readonly kind: "solid" | "ledge";
  readonly before: Readonly<Rect>;
  readonly after: Readonly<Rect>;
  readonly segments?: readonly TraversalMotionSegment[];
}
export interface TraversalGeometry<Id> {
  readonly complete: boolean;
  readonly colliders: readonly TraversalCollider<Id>[];
}
export interface TraversalProfile {
  readonly gravity: number;
  readonly jumpSpeed: number;
  readonly maxFallSpeed: number;
  readonly walkSpeed: number;
}
export interface TraversalState<Id> {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly supportId?: Id;
  readonly fallFromY: number;
}
export interface TraversalInput {
  readonly move: -1 | 0 | 1;
  readonly jump: boolean;
  readonly timeSeconds: number;
}
export type TraversalCommand = Pick<TraversalInput, "move" | "jump">;
export interface TraversalSafety {
  readonly from: Readonly<Rect>;
  readonly to: Readonly<Rect>;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly phase: "sweep" | "landing";
}
export interface TraversalContext<Id> {
  readonly body: { readonly width: number; readonly height: number; readonly offset: Point };
  readonly profile: TraversalProfile;
  readonly dtSeconds: number;
  readonly epsilon: number;
  readonly bounds: Readonly<Rect>;
  readonly maxDrop: number;
  readonly maxCollisionSteps: number;
  readonly sampleColliders: (
    timeSeconds: number,
    dtSeconds: number,
    queryBounds: Readonly<Rect>,
  ) => TraversalGeometry<Id>;
  readonly safe: (request: TraversalSafety) => boolean;
}
export interface TraversalStepResult<Id> {
  readonly status:
    "ok" | "blocked" | "unsafe" | "out-of-bounds" | "geometry-unavailable" | "budget-exhausted";
  readonly state: TraversalState<Id>;
  readonly segments: readonly TraversalSafety[];
}
export interface TraversalBudget {
  readonly horizonSteps: number;
  readonly maxStates: number;
  readonly maxSteps: number;
}
export interface TraversalRequest<Id> extends TraversalBudget {
  readonly start: TraversalState<Id>;
  readonly timeSeconds: number;
  // A landing envelope containing the complete actor, not the target actor's smaller box.
  readonly goal: Readonly<Rect>;
  readonly preferredInputs?: readonly TraversalCommand[];
}
export interface TraversalWork {
  readonly states: number;
  readonly steps: number;
}
export type TraversalResult<Id> =
  | {
      readonly status: "found";
      readonly inputs: readonly TraversalInput[];
      readonly state: TraversalState<Id>;
      readonly work: TraversalWork;
    }
  | { readonly status: "unreachable"; readonly horizonSteps: number; readonly work: TraversalWork }
  | { readonly status: "geometry-unavailable"; readonly work: TraversalWork }
  | {
      readonly status: "budget-exhausted";
      readonly reason: "states" | "steps" | "collision";
      readonly work: TraversalWork;
    };

export type TraversalAvailability<T> =
  { readonly status: "available"; readonly value: T } | { readonly status: "unavailable" };

export type TraversalWorldSafety = "safe" | "unsafe" | "unavailable";

// Actual tick start and the planned actor's full physical body.
export interface TraversalWorldBegin {
  readonly timeSeconds: number;
  readonly dtSeconds: number;
  readonly body: Readonly<Rect>;
}

// Successful tick end; all resolved standing supports are in collider order.
export interface TraversalWorldEnd<Id> {
  readonly timeSeconds: number;
  readonly body: Readonly<Rect>;
  readonly standingSupportIds: readonly Id[];
}

export interface TraversalWorldAdapter<Id, World> {
  // Equal keys must imply identical future behaviour, including contact memory.
  readonly key: (world: World) => string;
  // Pure and idempotent at a boundary; process old deadlines before frame sampling.
  readonly beginStep: (world: World, request: TraversalWorldBegin) => TraversalAvailability<World>;
  // Record resolved contact changes for the next boundary, without changing this frame.
  readonly endStep: (world: World, request: TraversalWorldEnd<Id>) => TraversalAvailability<World>;
  readonly sampleColliders: (
    world: World,
    timeSeconds: number,
    dtSeconds: number,
    queryBounds: Readonly<Rect>,
  ) => TraversalGeometry<Id>;
  readonly safe: (world: World, request: TraversalSafety) => TraversalWorldSafety;
}

export type WorldTraversalContext<Id, World> = Omit<
  TraversalContext<Id>,
  "sampleColliders" | "safe"
> & {
  readonly world: TraversalWorldAdapter<Id, World>;
};

export type WorldTraversalState<Id, World> = TraversalState<Id> & { readonly world: World };

export type WorldTraversalRequest<Id, World> = Omit<TraversalRequest<Id>, "start"> & {
  readonly start: WorldTraversalState<Id, World>;
};

export type WorldTraversalStepResult<Id, World> = Omit<TraversalStepResult<Id>, "state"> & {
  readonly state: WorldTraversalState<Id, World>;
};

export type WorldTraversalResult<Id, World> =
  | (Omit<Extract<TraversalResult<Id>, { status: "found" }>, "state"> & {
      readonly state: WorldTraversalState<Id, World>;
    })
  | Exclude<TraversalResult<Id>, { status: "found" }>;

function validRect(rect: Readonly<Rect>): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}
function box<Id>(context: Pick<TraversalContext<Id>, "body">, state: TraversalState<Id>): Rect {
  return {
    height: context.body.height,
    width: context.body.width,
    x: state.x + context.body.offset.x,
    y: state.y + context.body.offset.y,
  };
}
function inside(outer: Readonly<Rect>, inner: Readonly<Rect>, epsilon: number): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}
function overlaps(a: Readonly<Rect>, b: Readonly<Rect>, epsilon: number): boolean {
  return (
    a.x < b.x + b.width - epsilon &&
    b.x < a.x + a.width - epsilon &&
    a.y < b.y + b.height - epsilon &&
    b.y < a.y + a.height - epsilon
  );
}
function validate<Id>(
  context: Omit<TraversalContext<Id>, "sampleColliders" | "safe">,
  state: TraversalState<Id>,
  time: number,
): void {
  const { body, profile } = context;
  if (
    !validRect(context.bounds) ||
    !validRect(box(context, state)) ||
    ![state.vy, state.fallFromY, time, body.offset.x, body.offset.y].every(Number.isFinite) ||
    ![context.dtSeconds, profile.gravity, profile.maxFallSpeed].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    ![context.epsilon, context.maxDrop, profile.walkSpeed, profile.jumpSpeed].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
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
function validGeometry<Id>(time: number, dt: number, geometry: TraversalGeometry<Id>): boolean {
  if (!geometry.complete) {
    return false;
  }
  const ids = new Set<Id>();
  for (const c of geometry.colliders) {
    if (
      ids.has(c.supportId) ||
      !["solid", "ledge"].includes(c.kind) ||
      !validRect(c.before) ||
      !validRect(c.after)
    ) {
      return false;
    }
    ids.add(c.supportId);
    let previous = c.before;
    let at = time;
    for (const s of motions(time, dt, c)) {
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
function atTime<Id>(time: number, dt: number, collider: TraversalCollider<Id>, at: number): Rect {
  const list = collider.segments;
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
function supports<Id>(
  epsilon: number,
  rect: Readonly<Rect>,
  colliders: readonly TraversalCollider<Id>[],
  endpoint: "before" | "after",
): TraversalCollider<Id> | undefined {
  const candidates = colliders
    .filter(
      (c) =>
        Math.abs(c[endpoint].y - rect.y - rect.height) <= epsilon &&
        c[endpoint].x < rect.x + rect.width &&
        c[endpoint].x + c[endpoint].width > rect.x,
    )
    .sort((a, b) => a[endpoint].x - b[endpoint].x);
  let edge = rect.x;
  for (const c of candidates) {
    if (c[endpoint].x > edge + epsilon) {
      return undefined;
    }
    edge = Math.max(edge, c[endpoint].x + c[endpoint].width);
    if (edge >= rect.x + rect.width - epsilon) {
      const first = candidates[0]!;
      if (
        candidates.some(
          (c) =>
            c.after.x - c.before.x !== first.after.x - first.before.x ||
            c.after.y - c.before.y !== first.after.y - first.before.y,
        )
      ) {
        return undefined;
      }
      return first;
    }
  }
  return undefined;
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
  const slab = (
    from: number,
    length: number,
    start: number,
    size: number,
    delta: number,
  ): [number, number] =>
    delta === 0
      ? from < start + size - epsilon && from + length > start + epsilon
        ? [-Infinity, Infinity]
        : [Infinity, -Infinity]
      : delta > 0
        ? [(start - from - length) / delta, (start + size - from) / delta]
        : [(start + size - from) / delta, (start - from - length) / delta];
  const [x0, x1] = slab(body.x, body.width, solid.x, solid.width, rx);
  const [y0, y1] = slab(body.y, body.height, solid.y, solid.height, ry);
  const enter = Math.max(x0, y0);
  if (enter < -epsilon || enter > 1 || enter >= Math.min(x1, y1) || Math.min(x1, y1) < 0) {
    return undefined;
  }
  const axis = x0 > y0 ? "x" : "y";
  return { axis, fraction: Math.max(0, enter), velocity: (axis === "x" ? sx : sy) / seconds };
}

// Every search edge and runtime move executes this same atomic fixed step.
function stepKernel<Id>(
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
): TraversalStepResult<Id> {
  validate(context, state, input.timeSeconds);
  if (![-1, 0, 1].includes(input.move)) {
    throw new RangeError("Invalid traversal input");
  }
  const fail = (status: TraversalStepResult<Id>["status"]): TraversalStepResult<Id> => ({
    segments: [],
    state,
    status,
  });
  const { dtSeconds: dt, epsilon: e } = context;
  const time = input.timeSeconds;
  let body = box(context, state);
  if (!inside(context.bounds, body, e)) {
    return fail("out-of-bounds");
  }
  const first = context.sampleColliders(time, dt, body);
  if (!validGeometry(time, dt, first)) {
    return fail("geometry-unavailable");
  }
  const supported = supports(e, body, first.colliders, "before");
  const carrier =
    state.grounded && supported
      ? (first.colliders.find(
          (c) =>
            c.supportId === state.supportId &&
            Math.abs(c.before.y - body.y - body.height) <= e &&
            c.before.x < body.x + body.width &&
            c.before.x + c.before.width > body.x,
        ) ?? supported)
      : undefined;
  let vy = Math.min(
    context.profile.maxFallSpeed,
    (input.jump && carrier ? -context.profile.jumpSpeed : carrier ? 0 : state.vy) +
      context.profile.gravity * dt,
  );
  const vx = input.move * context.profile.walkSpeed;
  // Include every intermediate carrier extremum, not only its endpoint delta.
  const points = carrier ? motions(time, dt, carrier).flatMap((s) => [s.from, s.to]) : [];
  const shiftsX = [0, ...points.map((p) => p.x - carrier!.before.x)];
  const shiftsY = [0, ...points.map((p) => p.y - carrier!.before.y)];
  const x0 = Math.min(0, vx * dt) + Math.min(...shiftsX);
  const y0 = Math.min(0, vy * dt) + Math.min(...shiftsY);
  const query = {
    height: body.height + Math.max(0, vy * dt) + Math.max(...shiftsY) - y0 + 2 * e,
    width: body.width + Math.max(0, vx * dt) + Math.max(...shiftsX) - x0 + 2 * e,
    x: body.x + x0 - e,
    y: body.y + y0 - e,
  };
  // Incoming movers can push beyond locomotion bounds. Include their swept extents;
  // a later push outside this sampled domain is unknown rather than collision-free.
  for (const c of first.colliders) {
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
    return fail("geometry-unavailable");
  }
  const geometry = context.sampleColliders(time, dt, query);
  if (!validGeometry(time, dt, geometry)) {
    return fail("geometry-unavailable");
  }
  if (
    carrier &&
    !geometry.colliders.some(
      (c) =>
        c.supportId === carrier.supportId &&
        same(c.before, carrier.before) &&
        same(c.after, carrier.after),
    )
  ) {
    return fail("geometry-unavailable");
  }
  if (geometry.colliders.some((c) => c.kind === "solid" && overlaps(body, c.before, e))) {
    return fail("blocked");
  }
  // Allocate the set and sort only when a segment adds another boundary value.
  const stepEnd = time + dt;
  let boundaries: Set<number> | undefined;
  for (const collider of geometry.colliders) {
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
  const times = boundaries
    ? [...boundaries].sort((a, b) => a - b)
    : startBoundary === endBoundary
      ? [startBoundary]
      : [startBoundary, endBoundary];
  const segments: TraversalSafety[] = [];
  let iterations = 0;
  let fallFromY = carrier ? body.y + body.height : state.fallFromY;
  for (let i = 1; i < times.length; i++) {
    let now = times[i - 1]!;
    const end = times[i]!;
    const carried = carrier && !input.jump ? carrier : undefined;
    const a = carried ? atTime(time, dt, carried, now) : undefined;
    const b = carried ? atTime(time, dt, carried, end) : undefined;
    let movingX = vx + (a && b ? (b.x - a.x) / (end - now) : 0);
    let movingY = vy + (a && b ? (b.y - a.y) / (end - now) : 0);
    let constrainedAt = -Infinity;
    const constrained = new Set<"x" | "y">();
    while (now < end) {
      if (++iterations > context.maxCollisionSteps) {
        return fail("budget-exhausted");
      }
      const seconds = end - now;
      let nearest: Hit | undefined;
      for (const c of geometry.colliders) {
        const from = atTime(time, dt, c, now);
        const to = atTime(time, dt, c, end);
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
        ...body,
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
        return fail("out-of-bounds");
      }
      if (!inside(query, next, e)) {
        return fail("geometry-unavailable");
      }
      fallFromY = Math.min(fallFromY, next.y + next.height);
      if (next.y + next.height - fallFromY > context.maxDrop + e || !context.safe(segment)) {
        return fail("unsafe");
      }
      segments.push(segment);
      body = next;
      now = arrival;
      if (nearest) {
        if (constrainedAt !== now) {
          constrained.clear();
          constrainedAt = now;
        }
        if (constrained.has(nearest.axis)) {
          return fail("blocked");
        }
        constrained.add(nearest.axis);
        if (nearest.axis === "x") {
          movingX = nearest.velocity;
        } else {
          movingY = nearest.velocity;
          vy = 0;
        }
      }
      if (
        geometry.colliders.some(
          (c) => c.kind === "solid" && overlaps(body, atTime(time, dt, c, now), e),
        )
      ) {
        return fail("blocked");
      }
    }
  }
  const support = vy >= 0 ? supports(e, body, geometry.colliders, "after") : undefined;
  if (geometry.colliders.some((c) => c.kind === "solid" && overlaps(body, c.after, e))) {
    return fail("blocked");
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
      return fail("unsafe");
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

function findKernel<Id>(
  context: TraversalContext<Id>,
  request: TraversalRequest<Id>,
  world?: SearchWorld<Id>,
): TraversalResult<Id> {
  validate(context, request.start, request.timeSeconds);
  if (
    !validRect(request.goal) ||
    ![request.horizonSteps, request.maxStates, request.maxSteps].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    request.maxStates < 1 ||
    !Number.isFinite(request.timeSeconds + request.horizonSteps * context.dtSeconds)
  ) {
    throw new RangeError("Invalid traversal search domain");
  }
  const commands = request.preferredInputs;
  if (commands !== undefined) {
    if (!Array.isArray(commands) || commands.length > request.horizonSteps) {
      throw new RangeError("Invalid preferred traversal inputs");
    }
    for (const command of commands) {
      if (
        command === null ||
        (typeof command !== "object" && typeof command !== "function") ||
        "timeSeconds" in command ||
        ![-1, 0, 1].includes(command.move) ||
        typeof command.jump !== "boolean"
      ) {
        throw new RangeError("Invalid preferred traversal inputs");
      }
    }
  }
  interface Node {
    state: TraversalState<Id>;
    depth: number;
    parent?: Node;
    input?: TraversalInput;
    score: number;
    order: number;
  }
  const work = { states: 1, steps: 0 };
  const initialFrame = world?.prepare(request.start, request.timeSeconds);
  if (initialFrame?.status === "unavailable") {
    return { status: "geometry-unavailable", work };
  }
  const initialContext = initialFrame?.value.context ?? context;
  const initialGeometry = initialContext.sampleColliders(
    request.timeSeconds,
    context.dtSeconds,
    box(context, request.start),
  );
  if (!validGeometry(request.timeSeconds, context.dtSeconds, initialGeometry)) {
    return { status: "geometry-unavailable", work };
  }
  const frontier: Node[] = [];
  const identities = new Map<Id, number>();
  const key = (depth: number, s: TraversalState<Id>) => {
    if (s.supportId !== undefined && !identities.has(s.supportId)) {
      identities.set(s.supportId, identities.size);
    }
    const support = s.supportId === undefined ? "none" : identities.get(s.supportId);
    const physical = `${depth}:${s.x}:${s.y}:${s.vy}:${s.grounded}:${s.fallFromY}:${support}`;
    if (!world) {
      return physical;
    }
    const worldKey = world.key(s);
    return `${physical}:${worldKey.length}:${worldKey}`;
  };
  const seen = new Set([key(0, request.start)]);
  const hasPreferred = commands !== undefined && commands.length > 0;
  // Charging a preferred state must not prune it from the independent frontier.
  const charged = hasPreferred ? new Set(seen) : undefined;
  let frontierOrder = 1;
  const distance = (state: TraversalState<Id>) => {
    const b = box(context, state);
    // Ascent can clear an obstruction before descending into the landing corridor.
    // Zero vertical speed above that corridor also includes partial ledge contacts.
    return (
      Math.max(0, request.goal.x - b.x, b.x + b.width - request.goal.x - request.goal.width) +
      Math.max(0, b.y + b.height - request.goal.y - request.goal.height) +
      (state.vy === 0 ? Math.max(0, request.goal.y - b.y) : 0)
    );
  };
  // Stable sort followed by pop selects the latest insertion on an exact tie.
  // Cache only scores derived from immutable states and the fixed request goal.
  const preferred = (a: Node, b: Node) =>
    (b.score - a.score || a.depth - b.depth || a.order - b.order) > 0;
  const push = (node: Node) => {
    let index = frontier.length;
    frontier.push(node);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!preferred(node, frontier[parent]!)) {
        break;
      }
      frontier[index] = frontier[parent]!;
      index = parent;
    }
    frontier[index] = node;
  };
  const pop = (): Node => {
    const node = frontier[0]!;
    const last = frontier.pop()!;
    if (frontier.length) {
      let index = 0;
      while (index * 2 + 1 < frontier.length) {
        let child = index * 2 + 1;
        if (child + 1 < frontier.length && preferred(frontier[child + 1]!, frontier[child]!)) {
          child++;
        }
        if (!preferred(frontier[child]!, last)) {
          break;
        }
        frontier[index] = frontier[child]!;
        index = child;
      }
      frontier[index] = last;
    }
    return node;
  };
  const initial: Node = {
    depth: 0,
    order: 0,
    score: distance(request.start),
    state: request.start,
  };
  const terminal = (node: Node): TraversalResult<Id> | undefined => {
    if (node.state.grounded && inside(request.goal, box(context, node.state), context.epsilon)) {
      // Validate even an empty witness against actual geometry and caller safety.
      const body = box(context, node.state);
      const time = request.timeSeconds + node.depth * context.dtSeconds;
      const frame = world?.prepare(node.state, time);
      if (frame?.status === "unavailable") {
        return { status: "geometry-unavailable", work };
      }
      const terminalContext = frame?.value.context ?? context;
      const terminalState = frame?.value.state ?? node.state;
      const g = terminalContext.sampleColliders(time, context.dtSeconds, body);
      if (!validGeometry(time, context.dtSeconds, g)) {
        return { status: "geometry-unavailable", work };
      }
      if (
        supports(context.epsilon, body, g.colliders, "before") &&
        !g.colliders.some((c) => c.kind === "solid" && overlaps(body, c.before, context.epsilon)) &&
        inside(context.bounds, body, context.epsilon) &&
        terminalContext.safe({
          endSeconds: time,
          from: body,
          phase: "landing",
          startSeconds: time,
          to: body,
        })
      ) {
        const inputs: TraversalInput[] = [];
        let cursor: Node | undefined = node;
        while (cursor?.input) {
          inputs.push(cursor.input);
          cursor = cursor.parent;
        }
        return { inputs: inputs.reverse(), state: terminalState, status: "found", work };
      }
      if (frame?.value.unavailable) {
        return { status: "geometry-unavailable", work };
      }
    }
    return undefined;
  };
  push(initial);
  if (hasPreferred) {
    const found = terminal(initial);
    if (found) {
      return found;
    }
    let node = initial;
    for (const command of commands) {
      if (work.steps === request.maxSteps) {
        return { reason: "steps", status: "budget-exhausted", work };
      }
      const input: TraversalInput = {
        jump: command.jump,
        move: command.move,
        timeSeconds: request.timeSeconds + node.depth * context.dtSeconds,
      };
      work.steps++;
      const result = world ? world.step(input, node.state) : stepKernel(context, input, node.state);
      if (result.status === "geometry-unavailable") {
        return { status: "geometry-unavailable", work };
      }
      if (result.status === "budget-exhausted") {
        return { reason: "collision", status: "budget-exhausted", work };
      }
      if (result.status !== "ok") {
        break;
      }
      const id = key(node.depth + 1, result.state);
      if (!charged!.has(id)) {
        if (work.states === request.maxStates) {
          return { reason: "states", status: "budget-exhausted", work };
        }
        charged!.add(id);
        work.states++;
      }
      node = {
        depth: node.depth + 1,
        input,
        order: 0,
        parent: node,
        score: 0,
        state: result.state,
      };
      const reached = terminal(node);
      if (reached) {
        return reached;
      }
    }
  }
  while (frontier.length) {
    const node = pop();
    // The original start was already checked before an opted-in preferred path.
    const found = node === initial && hasPreferred ? undefined : terminal(node);
    if (found) {
      return found;
    }
    if (node.depth === request.horizonSteps) {
      continue;
    }
    for (const move of [-1, 0, 1] as const) {
      for (const jump of node.state.grounded ? [false, true] : [false]) {
        if (work.steps === request.maxSteps) {
          return { reason: "steps", status: "budget-exhausted", work };
        }
        const input = {
          jump,
          move,
          timeSeconds: request.timeSeconds + node.depth * context.dtSeconds,
        };
        work.steps++;
        const result = world
          ? world.step(input, node.state)
          : stepKernel(context, input, node.state);
        if (result.status === "geometry-unavailable") {
          return { status: "geometry-unavailable", work };
        }
        if (result.status === "budget-exhausted") {
          return { reason: "collision", status: "budget-exhausted", work };
        }
        if (result.status !== "ok") {
          continue;
        }
        const id = key(node.depth + 1, result.state);
        if (seen.has(id)) {
          continue;
        }
        if (!charged || !charged.has(id)) {
          if (work.states === request.maxStates) {
            return { reason: "states", status: "budget-exhausted", work };
          }
          charged?.add(id);
          work.states++;
        }
        seen.add(id);
        push({
          depth: node.depth + 1,
          input,
          order: ++frontierOrder,
          parent: node,
          score: distance(result.state),
          state: result.state,
        });
      }
    }
  }
  return { horizonSteps: request.horizonSteps, status: "unreachable", work };
}

interface PreparedWorld<Id> {
  readonly context: TraversalContext<Id>;
  readonly state: TraversalState<Id>;
  unavailable: boolean;
  geometry?: TraversalGeometry<Id>;
}
interface SearchWorld<Id> {
  readonly prepare: (
    state: TraversalState<Id>,
    timeSeconds: number,
  ) => TraversalAvailability<PreparedWorld<Id>>;
  readonly key: (state: TraversalState<Id>) => string;
  readonly step: (input: TraversalInput, state: TraversalState<Id>) => TraversalStepResult<Id>;
}

function prepareWorld<Id, World>(
  context: WorldTraversalContext<Id, World>,
  timeSeconds: number,
  state: WorldTraversalState<Id, World>,
): TraversalAvailability<PreparedWorld<Id>> {
  const begun = context.world.beginStep(state.world, {
    body: box(context, state),
    dtSeconds: context.dtSeconds,
    timeSeconds,
  });
  if (begun.status === "unavailable") {
    return begun;
  }
  const preparedState = { ...state, world: begun.value };
  const prepared: PreparedWorld<Id> = {
    context: {
      ...context,
      safe: (request) => {
        const safety = context.world.safe(begun.value, request);
        if (safety === "unavailable") {
          prepared.unavailable = true;
        }
        return safety === "safe";
      },
      sampleColliders: (time, dt, bounds) => {
        const geometry = context.world.sampleColliders(begun.value, time, dt, bounds);
        prepared.geometry = geometry;
        return geometry;
      },
    },
    state: preparedState,
    unavailable: false,
  };
  return { status: "available", value: prepared };
}

function stepWorld<Id, World>(
  context: WorldTraversalContext<Id, World>,
  input: TraversalInput,
  state: WorldTraversalState<Id, World>,
  frame: TraversalAvailability<PreparedWorld<Id>>,
): WorldTraversalStepResult<Id, World> {
  const fail = (
    status: TraversalStepResult<Id>["status"],
  ): WorldTraversalStepResult<Id, World> => ({
    segments: [],
    state,
    status,
  });
  if (frame.status === "unavailable") {
    return fail("geometry-unavailable");
  }
  const prepared = frame.value;
  const result = stepKernel(prepared.context, input, state);
  if (prepared.unavailable) {
    return fail("geometry-unavailable");
  }
  if (result.status !== "ok") {
    return fail(result.status);
  }
  const body = box(context, result.state);
  const standingSupportIds = result.state.grounded
    ? prepared
        .geometry!.colliders.filter(
          (c) =>
            Math.abs(c.after.y - body.y - body.height) <= context.epsilon &&
            c.after.x < body.x + body.width &&
            c.after.x + c.after.width > body.x,
        )
        .map((c) => c.supportId)
    : [];
  const ended = context.world.endStep((prepared.state as WorldTraversalState<Id, World>).world, {
    body,
    standingSupportIds,
    timeSeconds: input.timeSeconds + context.dtSeconds,
  });
  if (ended.status === "unavailable") {
    return fail("geometry-unavailable");
  }
  return { ...result, state: { ...result.state, world: ended.value } };
}

export function stepTraversal<Id, World>(
  context: WorldTraversalContext<Id, World>,
  input: TraversalInput,
  state: WorldTraversalState<Id, World>,
): WorldTraversalStepResult<Id, World>;
export function stepTraversal<Id>(
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
): TraversalStepResult<Id>;
export function stepTraversal<Id, World>(
  context: TraversalContext<Id> | WorldTraversalContext<Id, World>,
  input: TraversalInput,
  state: TraversalState<Id> | WorldTraversalState<Id, World>,
): TraversalStepResult<Id> {
  if (!("world" in context)) {
    return stepKernel(context, input, state);
  }
  validate(context, state, input.timeSeconds);
  if (![-1, 0, 1].includes(input.move) || !("world" in state)) {
    throw new RangeError("Invalid traversal input or world state");
  }
  return stepWorld(context, input, state, prepareWorld(context, input.timeSeconds, state));
}

export function findTraversal<Id, World>(
  context: WorldTraversalContext<Id, World>,
  request: WorldTraversalRequest<Id, World>,
): WorldTraversalResult<Id, World>;
export function findTraversal<Id>(
  context: TraversalContext<Id>,
  request: TraversalRequest<Id>,
): TraversalResult<Id>;
export function findTraversal<Id, World>(
  context: TraversalContext<Id> | WorldTraversalContext<Id, World>,
  request: TraversalRequest<Id> | WorldTraversalRequest<Id, World>,
): TraversalResult<Id> {
  if (!("world" in context)) {
    return findKernel(context, request);
  }
  if (!("world" in request.start)) {
    throw new RangeError("Invalid traversal world state");
  }
  const frames = new WeakMap<TraversalState<Id>, TraversalAvailability<PreparedWorld<Id>>>();
  const prepare = (state: TraversalState<Id>, time: number) => {
    let frame = frames.get(state);
    if (!frame) {
      frame = prepareWorld(context, time, state as WorldTraversalState<Id, World>);
      frames.set(state, frame);
    }
    return frame;
  };
  // The core replaces these callbacks with the node's immutable phase snapshot.
  const base: TraversalContext<Id> = {
    ...context,
    safe: () => false,
    sampleColliders: () => ({ colliders: [], complete: false }),
  };
  return findKernel(base, request, {
    key: (state) => context.world.key((state as WorldTraversalState<Id, World>).world),
    prepare,
    step: (input, state) =>
      stepWorld(
        context,
        input,
        state as WorldTraversalState<Id, World>,
        prepare(state, input.timeSeconds),
      ),
  });
}
