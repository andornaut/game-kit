import type { Rect } from "../rect.ts";
import type { TraversalAvailability } from "./traversal.ts";

export interface CrumblingProfile {
  readonly warningSeconds: number;
  readonly absentSeconds: number;
}

export interface CrumblingDefinition<SupportId> {
  readonly supportId: SupportId;
  readonly volume: Readonly<Rect>;
  readonly profile: CrumblingProfile;
}

export interface StandingContact<SupportId, ActorId> {
  readonly supportId: SupportId;
  readonly actorId: ActorId;
}

export type CrumblingPhase =
  | { readonly kind: "intact" }
  | { readonly kind: "warning"; readonly removeAtSeconds: number }
  | { readonly kind: "absent"; readonly restoreAfterSeconds: number };

export interface CrumblingSupport<SupportId> {
  readonly supportId: SupportId;
  readonly phase: CrumblingPhase;
}

export interface CrumblingWorld<SupportId, ActorId> {
  readonly supports: readonly CrumblingSupport<SupportId>[];
  readonly standingContacts: readonly StandingContact<SupportId, ActorId>[];
  readonly pendingContacts: readonly StandingContact<SupportId, ActorId>[];
  readonly begunAtSeconds: number | null;
}

export type CrumblingOccupancy = "clear" | "occupied" | "unknown";

export interface CrumblingOccupancyRequest<SupportId, ActorId> {
  readonly supportId: SupportId;
  readonly timeSeconds: number;
  readonly volume: Readonly<Rect>;
  readonly branchActor: {
    readonly actorId: ActorId;
    readonly body: Readonly<Rect>;
  };
}

export interface CrumblingContext<SupportId, ActorId> {
  readonly definitions: readonly CrumblingDefinition<SupportId>[];
  // Full collider volume against all bodies, substituting branchActor for its live body.
  readonly occupancy: (
    request: CrumblingOccupancyRequest<SupportId, ActorId>,
  ) => CrumblingOccupancy;
}

export interface CrumblingBegin<ActorId> {
  readonly timeSeconds: number;
  readonly branchActor: {
    readonly actorId: ActorId;
    readonly body: Readonly<Rect>;
  };
}

export interface CrumblingEnd<SupportId, ActorId> {
  readonly timeSeconds: number;
  readonly standingContacts: readonly StandingContact<SupportId, ActorId>[];
}

function sameIdentity<T>(a: T, b: T): boolean {
  return a === b || Object.is(a, b);
}

function hasContact<SupportId, ActorId>(
  contacts: readonly StandingContact<SupportId, ActorId>[],
  contact: StandingContact<SupportId, ActorId>,
): boolean {
  return contacts.some(
    (c) => sameIdentity(c.supportId, contact.supportId) && sameIdentity(c.actorId, contact.actorId),
  );
}

// Deadlines use active-world seconds; phase changes occur only at tick starts.
export function beginCrumblingStep<SupportId, ActorId>(
  context: CrumblingContext<SupportId, ActorId>,
  request: CrumblingBegin<ActorId>,
  world: CrumblingWorld<SupportId, ActorId>,
): TraversalAvailability<CrumblingWorld<SupportId, ActorId>> {
  if (
    !Number.isFinite(request.timeSeconds) ||
    (world.begunAtSeconds !== null && request.timeSeconds < world.begunAtSeconds)
  ) {
    throw new RangeError("Invalid crumbling boundary time");
  }
  if (world.begunAtSeconds === request.timeSeconds) {
    return { status: "available", value: world };
  }
  const definitions = new Map(context.definitions.map((d) => [d.supportId, d]));
  if (definitions.size !== context.definitions.length) {
    throw new RangeError("Duplicate crumbling support identity");
  }
  const supports: CrumblingSupport<SupportId>[] = [];
  for (const support of world.supports) {
    const definition = definitions.get(support.supportId);
    if (
      !definition ||
      ![definition.profile.warningSeconds, definition.profile.absentSeconds].every(
        (n) => Number.isFinite(n) && n > 0,
      ) ||
      (support.phase.kind === "warning" && !Number.isFinite(support.phase.removeAtSeconds)) ||
      (support.phase.kind === "absent" && !Number.isFinite(support.phase.restoreAfterSeconds))
    ) {
      throw new RangeError("Invalid crumbling support configuration or phase");
    }
    let phase = support.phase;
    if (phase.kind === "warning" && phase.removeAtSeconds <= request.timeSeconds) {
      phase = {
        kind: "absent",
        restoreAfterSeconds: request.timeSeconds + definition.profile.absentSeconds,
      };
    } else if (phase.kind === "absent" && phase.restoreAfterSeconds <= request.timeSeconds) {
      const occupancy = context.occupancy({
        branchActor: request.branchActor,
        supportId: support.supportId,
        timeSeconds: request.timeSeconds,
        volume: definition.volume,
      });
      if (occupancy === "unknown") {
        return { status: "unavailable" };
      }
      if (occupancy === "clear") {
        phase = { kind: "intact" };
      }
    }
    // Old-phase expiry wins over contacts, and restoration alone cannot rearm.
    if (
      support.phase.kind === "intact" &&
      world.pendingContacts.some((c) => sameIdentity(c.supportId, support.supportId))
    ) {
      phase = {
        kind: "warning",
        removeAtSeconds: request.timeSeconds + definition.profile.warningSeconds,
      };
    }
    if (
      (phase.kind === "warning" && !Number.isFinite(phase.removeAtSeconds)) ||
      (phase.kind === "absent" && !Number.isFinite(phase.restoreAfterSeconds))
    ) {
      throw new RangeError("Invalid crumbling deadline");
    }
    supports.push({ phase, supportId: support.supportId });
  }
  return {
    status: "available",
    value: {
      begunAtSeconds: request.timeSeconds,
      pendingContacts: [],
      standingContacts: world.standingContacts,
      supports,
    },
  };
}

// The complete contact set must include explicitly known other-actor contacts.
export function endCrumblingStep<SupportId, ActorId>(
  request: CrumblingEnd<SupportId, ActorId>,
  world: CrumblingWorld<SupportId, ActorId>,
): CrumblingWorld<SupportId, ActorId> {
  if (
    !Number.isFinite(request.timeSeconds) ||
    world.begunAtSeconds === null ||
    request.timeSeconds < world.begunAtSeconds
  ) {
    throw new RangeError("Invalid crumbling contact time");
  }
  const standingContacts: StandingContact<SupportId, ActorId>[] = [];
  const pendingContacts = [...world.pendingContacts];
  for (const contact of request.standingContacts) {
    if (!hasContact(standingContacts, contact)) {
      standingContacts.push(contact);
      if (!hasContact(world.standingContacts, contact) && !hasContact(pendingContacts, contact)) {
        pendingContacts.push(contact);
      }
    }
  }
  return { ...world, pendingContacts, standingContacts };
}
