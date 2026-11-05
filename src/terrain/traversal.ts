import type { Point, Rect } from "../rect.ts";
import {
  box,
  inside,
  overlaps,
  siblingSteps,
  stepKernel,
  supports,
  validate,
  validGeometry,
  validRect,
} from "./traversalStep.ts";

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
    // Every child input shares the node's state and clock.
    const step = world ? world.siblings(node.state) : siblingSteps(context, node.state);
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
        const result = step(input);
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
  readonly siblings: (
    state: TraversalState<Id>,
  ) => (input: TraversalInput) => TraversalStepResult<Id>;
}
type StepKernel<Id> = (
  context: TraversalContext<Id>,
  input: TraversalInput,
  state: TraversalState<Id>,
) => TraversalStepResult<Id>;

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
  kernel: StepKernel<Id>,
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
  const result = kernel(prepared.context, input, state);
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
  return stepWorld(
    context,
    stepKernel,
    input,
    state,
    prepareWorld(context, input.timeSeconds, state),
  );
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
    // A state's cached frame gives every sibling input the same prepared context.
    siblings: (state) => {
      let step: ((input: TraversalInput) => TraversalStepResult<Id>) | undefined;
      const kernel: StepKernel<Id> = (prepared, input) =>
        (step ??= siblingSteps(prepared, state))(input);
      return (input) =>
        stepWorld(
          context,
          kernel,
          input,
          state as WorldTraversalState<Id, World>,
          prepare(state, input.timeSeconds),
        );
    },
    step: (input, state) =>
      stepWorld(
        context,
        stepKernel,
        input,
        state as WorldTraversalState<Id, World>,
        prepare(state, input.timeSeconds),
      ),
  });
}
