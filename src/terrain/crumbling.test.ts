import { describe, expect, it } from "vitest";

import {
  beginCrumblingStep,
  type CrumblingContext,
  type CrumblingOccupancy,
  type CrumblingWorld,
  endCrumblingStep,
} from "./crumbling.ts";

const supportId = {};
const actorId = {};
const otherActor = {};
const body = { height: 2, width: 2, x: 0, y: 8 };
const volume = { height: 2, width: 10, x: -4, y: 10 };
const contact = { actorId, supportId };
const initial: CrumblingWorld<object, object> = {
  begunAtSeconds: null,
  pendingContacts: [],
  standingContacts: [],
  supports: [{ phase: { kind: "intact" }, supportId }],
};
function context(occupancy: CrumblingOccupancy = "clear"): CrumblingContext<object, object> {
  return {
    definitions: [{ profile: { absentSeconds: 3, warningSeconds: 1 }, supportId, volume }],
    occupancy: () => occupancy,
  };
}
function begin(world: CrumblingWorld<object, object>, timeSeconds: number, c = context()) {
  const result = beginCrumblingStep(c, { branchActor: { actorId, body }, timeSeconds }, world);
  if (result.status !== "available") {
    throw new Error("Expected available world");
  }
  return result.value;
}

describe("crumbling fixed tick phases", () => {
  it("latches new multi-actor contacts once at the next boundary without mutating snapshots", () => {
    const begun = begin(initial, 0);
    const ended = endCrumblingStep(
      {
        standingContacts: [contact, contact, { actorId: otherActor, supportId }],
        timeSeconds: 0.25,
      },
      begun,
    );
    expect(ended.pendingContacts).toHaveLength(2);
    expect(begun.pendingContacts).toEqual([]);
    const warning = begin(ended, 0.25);
    expect(warning.supports[0]!.phase).toEqual({ kind: "warning", removeAtSeconds: 1.25 });
    expect(initial.supports[0]!.phase).toEqual({ kind: "intact" });
    const left = endCrumblingStep({ standingContacts: [], timeSeconds: 0.5 }, warning);
    const returned = endCrumblingStep(
      { standingContacts: [contact], timeSeconds: 0.75 },
      begin(left, 0.5),
    );
    expect(begin(returned, 0.75).supports[0]!.phase).toEqual(warning.supports[0]!.phase);
  });

  it("expires before same-boundary contacts and measures absence from actual removal", () => {
    const world: CrumblingWorld<object, object> = {
      ...initial,
      pendingContacts: [contact],
      supports: [{ phase: { kind: "warning", removeAtSeconds: 1 }, supportId }],
    };
    const removed = begin(world, 1.5);
    expect(removed.supports[0]!.phase).toEqual({ kind: "absent", restoreAfterSeconds: 4.5 });
    expect(removed.pendingContacts).toEqual([]);
    expect(begin(removed, 4).supports[0]!.phase.kind).toBe("absent");
  });

  it("checks the complete volume once per boundary, retries occupied, and stops on unknown", () => {
    const world: CrumblingWorld<object, object> = {
      ...initial,
      supports: [{ phase: { kind: "absent", restoreAfterSeconds: 1 }, supportId }],
    };
    const calls: unknown[] = [];
    const c = {
      ...context("occupied"),
      occupancy: (request: unknown) => {
        calls.push(request);
        return "occupied" as const;
      },
    };
    const occupied = begin(world, 1, c);
    expect(calls).toEqual([{ branchActor: { actorId, body }, supportId, timeSeconds: 1, volume }]);
    expect(begin(occupied, 1, c)).toBe(occupied);
    expect(calls).toHaveLength(1);
    begin(occupied, 1.25, c);
    expect(calls).toHaveLength(2);
    expect(
      beginCrumblingStep(
        context("unknown"),
        { branchActor: { actorId, body }, timeSeconds: 1.25 },
        occupied,
      ),
    ).toEqual({ status: "unavailable" });
    expect(occupied.supports[0]!.phase.kind).toBe("absent");
    const restored = begin(occupied, 1.25);
    expect(restored.supports[0]!.phase.kind).toBe("intact");
    expect(restored.pendingContacts).toEqual([]);
    const landed = endCrumblingStep({ standingContacts: [contact], timeSeconds: 1.5 }, restored);
    expect(begin(landed, 1.5).supports[0]!.phase).toEqual({
      kind: "warning",
      removeAtSeconds: 2.5,
    });
  });

  it("does not turn persistent standing or restoration into a new contact", () => {
    const world: CrumblingWorld<object, object> = {
      ...initial,
      pendingContacts: [contact],
      standingContacts: [contact],
      supports: [{ phase: { kind: "absent", restoreAfterSeconds: 1 }, supportId }],
    };
    const restored = begin(world, 1);
    expect(restored.supports[0]!.phase.kind).toBe("intact");
    const ended = endCrumblingStep({ standingContacts: [contact], timeSeconds: 1.25 }, restored);
    expect(ended.pendingContacts).toEqual([]);
    expect(begin(ended, 1.25).supports[0]!.phase.kind).toBe("intact");
  });

  it("rejects backward clocks, invalid profiles and overflowing deadlines", () => {
    expect(() => begin(begin(initial, 1), 0)).toThrow(RangeError);
    expect(() =>
      begin(initial, 0, {
        ...context(),
        definitions: [{ profile: { absentSeconds: 1, warningSeconds: NaN }, supportId, volume }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      begin({ ...initial, pendingContacts: [contact] }, Number.MAX_VALUE, {
        ...context(),
        definitions: [
          { profile: { absentSeconds: 1, warningSeconds: Number.MAX_VALUE }, supportId, volume },
        ],
      }),
    ).toThrow(RangeError);
  });
});
