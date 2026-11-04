import { describe, expect, it } from "vitest";

import {
  type AchievementDef,
  award,
  CelebrationQueue,
  type ConditionKinds,
  earnedFormat,
  type EarnedRecord,
  earnedStore,
  judge,
  keepKnown,
  newlyEarned,
  orderByTier,
  resolveThreshold,
  type Threshold,
} from "./achievements.ts";
import { memoryStorage, type SaveStorage } from "./save/storage.ts";
import { loadSave } from "./save/versionedSave.ts";

// A synthetic catalogue: counters judged at either scope, a flag judged only at "end", and a
// marker kind with no progress.
type Scope = "end" | "step";
interface Facts {
  readonly coins: number;
  readonly flags: readonly string[];
  readonly gems: number;
  readonly total: number;
}
type Cond =
  | { readonly kind: "coins"; readonly count: Threshold }
  | { readonly kind: "flag"; readonly flag: string }
  | { readonly kind: "gems"; readonly count: number };
type Id = "a" | "b" | "c" | "d" | "e";
type Tier = "high" | "low" | "mid";

const KINDS: ConditionKinds<Cond, Scope, Facts> = {
  coins: {
    holds: (facts, { count }) => facts.coins >= resolveThreshold(facts.total, count),
    progress: (facts, { count }) => ({
      have: facts.coins,
      need: resolveThreshold(facts.total, count),
    }),
    scopes: ["end", "step"],
  },
  flag: { holds: (facts, { flag }) => facts.flags.includes(flag), scopes: ["end"] },
  gems: {
    holds: (facts, { count }) => facts.gems >= count,
    progress: (facts, { count }) => ({ have: facts.gems, need: count }),
    scopes: ["step"],
  },
};
const JUDGE = judge(KINDS);
const FACTS: Facts = { coins: 3, flags: ["x"], gems: 1, total: 10 };

const CATALOGUE: readonly AchievementDef<Id, Cond, Tier>[] = [
  { conditions: [{ count: 3, kind: "coins" }], id: "a", tier: "mid" },
  { conditions: [{ flag: "x", kind: "flag" }], id: "b", tier: "low" },
  {
    conditions: [
      { count: 3, kind: "coins" },
      { flag: "x", kind: "flag" },
    ],
    id: "c",
    tier: "high",
  },
  { conditions: [{ count: "all", kind: "coins" }], id: "d", tier: "low" },
  { conditions: [{ count: 1, kind: "gems" }], id: "e", tier: "mid" },
];
const IDS: readonly Id[] = CATALOGUE.map(({ id }) => id);
const KEYS = { backup: "kit:earned-backup", save: "kit:earned" };

describe("judge.holds", () => {
  it.each<[string, Scope, Facts, Cond, boolean]>([
    ["a met counter", "step", FACTS, { count: 3, kind: "coins" }, true],
    ["an unmet counter", "step", FACTS, { count: 4, kind: "coins" }, false],
    ["an unmet all", "end", FACTS, { count: "all", kind: "coins" }, false],
    ["a met all", "end", { ...FACTS, coins: 10 }, { count: "all", kind: "coins" }, true],
    ["a flag at its scope", "end", FACTS, { flag: "x", kind: "flag" }, true],
    ["a met flag outside its scope", "step", FACTS, { flag: "x", kind: "flag" }, false],
    ["a met gem count outside its scope", "end", FACTS, { count: 1, kind: "gems" }, false],
  ])("judges %s", (_, scope, facts, condition, holds) => {
    expect(JUDGE.holds(scope, facts, condition)).toBe(holds);
  });

  it("does not call an evaluator outside its scopes", () => {
    let calls = 0;
    const counted = judge<Cond, Scope, Facts>({
      ...KINDS,
      flag: { holds: () => (calls += 1) > 0, scopes: ["end"] },
    });
    expect(counted.holds("step", FACTS, { flag: "x", kind: "flag" })).toBe(false);
    expect(calls).toBe(0);
  });

  it("throws for an unregistered kind", () => {
    const stray = { kind: "toString" } as unknown as Cond;
    expect(() => JUDGE.holds("end", FACTS, stray)).toThrow(RangeError);
    expect(() => JUDGE.progress(FACTS, [stray])).toThrow(RangeError);
  });
});

describe("judge.progress", () => {
  it.each<[string, Facts, readonly Cond[], ReturnType<typeof JUDGE.progress>]>([
    ["one counter", FACTS, [{ count: 4, kind: "coins" }], { have: 3, need: 4 }],
    ["a counter past its need, capped", FACTS, [{ count: 2, kind: "coins" }], { have: 2, need: 2 }],
    [
      "a negative have, clamped",
      { ...FACTS, coins: -1 },
      [{ count: 2, kind: "coins" }],
      { have: 0, need: 2 },
    ],
    ["only kinds without progress", FACTS, [{ flag: "x", kind: "flag" }], undefined],
    ["no conditions", FACTS, [], undefined],
    [
      "the minimum fraction, not the minimum have",
      { ...FACTS, gems: 5 },
      [
        { count: 4, kind: "coins" },
        { count: 10, kind: "gems" },
      ],
      { have: 5, need: 10 },
    ],
    [
      "the first condition on a tied fraction",
      { ...FACTS, coins: 1, gems: 2 },
      [
        { count: 2, kind: "coins" },
        { count: 4, kind: "gems" },
      ],
      { have: 1, need: 2 },
    ],
    [
      "progress of a compound, leaving out a condition without progress",
      FACTS,
      [
        { flag: "y", kind: "flag" },
        { count: 3, kind: "coins" },
      ],
      { have: 3, need: 3 },
    ],
    [
      "a need of zero counted as done",
      { ...FACTS, gems: 0 },
      [
        { count: 0, kind: "gems" },
        { count: 6, kind: "coins" },
      ],
      { have: 3, need: 6 },
    ],
  ])("reports %s", (_, facts, conditions, progress) => {
    expect(JUDGE.progress(facts, conditions)).toEqual(progress);
  });

  it("ignores scope", () => {
    // gems is judged only at "step", but its progress is reported for display at any time.
    expect(JUDGE.progress(FACTS, [{ count: 4, kind: "gems" }])).toEqual({ have: 1, need: 4 });
  });
});

describe("resolveThreshold", () => {
  it.each<[number, Threshold, number]>([
    [7, "all", 7],
    [7, 3, 3],
    [0, "all", 0],
  ])("resolves (%s, %s) to %s", (all, threshold, count) => {
    expect(resolveThreshold(all, threshold)).toBe(count);
  });
});

describe("orderByTier", () => {
  it.each<[readonly Tier[], readonly Id[]]>([
    [
      ["low", "mid", "high"],
      ["b", "d", "a", "e", "c"],
    ],
    [
      ["high", "mid", "low"],
      ["c", "a", "e", "b", "d"],
    ],
  ])("orders by %j, keeping authored order within a tier", (tiers, ids) => {
    expect(orderByTier(tiers, CATALOGUE).map(({ id }) => id)).toEqual(ids);
  });

  it("does not change its input", () => {
    const before = [...CATALOGUE];
    orderByTier(["high", "mid", "low"], CATALOGUE);
    expect(CATALOGUE).toEqual(before);
  });

  it("throws for a tier the order leaves out", () => {
    const partial: readonly Tier[] = ["low", "mid"];
    expect(() => orderByTier(partial, CATALOGUE)).toThrow(RangeError);
  });
});

describe("newlyEarned", () => {
  it.each<[string, Scope, Facts, readonly Id[], readonly Id[]]>([
    ["at step, only step-scoped badges", "step", FACTS, [], ["a", "e"]],
    ["at end, the compound badge too", "end", FACTS, [], ["a", "b", "c"]],
    ["nothing already earned", "end", FACTS, ["a", "c"], ["b"]],
    ["the all threshold once met", "step", { ...FACTS, coins: 10 }, ["a", "e"], ["d"]],
    ["nothing when no condition holds", "end", { ...FACTS, coins: 0, flags: [] }, [], []],
  ])("earns %s", (_, scope, facts, earned, fresh) => {
    expect(newlyEarned(JUDGE, CATALOGUE, scope, facts, earned)).toEqual(fresh);
  });

  it("keeps catalogue order and returns a repeated id once", () => {
    const pick = (id: Id) => CATALOGUE.filter((def) => def.id === id);
    const catalogue = [...pick("b"), ...pick("a"), ...pick("b")];
    expect(newlyEarned(JUDGE, catalogue, "end", FACTS, [])).toEqual(["b", "a"]);
  });
});

describe("award", () => {
  it.each<[readonly Id[], readonly Id[], readonly Id[]]>([
    [["a"], [], ["a"]],
    [["b", "a"], ["c"], ["c", "b", "a"]],
    [["a", "b", "a"], ["b"], ["b", "a"]],
  ])("awards %j to %j", (ids, earned, next) => {
    expect(award(ids, earned)).toEqual(next);
  });

  it("returns the same list when nothing is added, and never mutates", () => {
    const earned: readonly Id[] = ["a", "b"];
    expect(award(["b", "a"], earned)).toBe(earned);
    expect(award([], earned)).toBe(earned);
    award(["c"], earned);
    expect(earned).toEqual(["a", "b"]);
  });

  it("is idempotent", () => {
    const once = award(["c", "a"], ["b"]);
    expect(award(["c", "a"], once)).toBe(once);
  });
});

describe("keepKnown", () => {
  it.each<[string, unknown, readonly Id[]]>([
    ["known ids in stored order", ["c", "a"], ["c", "a"]],
    ["without unknown ids", ["a", "z", 1, null, "b"], ["a", "b"]],
    ["without duplicates", ["b", "a", "b"], ["b", "a"]],
    ["empty for an object", { a: true }, []],
    ["empty for a string", "a", []],
    ["empty for undefined", undefined, []],
  ])("keeps %s", (_, stored, kept) => {
    expect(keepKnown(IDS, stored)).toEqual(kept);
  });
});

describe("earnedFormat", () => {
  const FORMAT = earnedFormat(1, IDS);
  const stored = (value: object) => JSON.stringify({ ...value, version: 1 });

  it.each<[string, object, EarnedRecord<Id>]>([
    [
      "a record",
      { earned: ["a", "b"], unannounced: ["b"] },
      { earned: ["a", "b"], unannounced: ["b"] },
    ],
    [
      "unknown and duplicate ids pruned",
      { earned: ["a", "gone", "a", "c"], unannounced: ["gone", "c", "c"] },
      { earned: ["a", "c"], unannounced: ["c"] },
    ],
    [
      "unannounced ids that are not earned dropped",
      { earned: ["a"], unannounced: ["b", "a"] },
      { earned: ["a"], unannounced: ["a"] },
    ],
  ])("loads %s", (_, value, record) => {
    expect(loadSave(FORMAT, stored(value))).toEqual({ save: record, status: "loaded" });
  });

  it.each<[string, object]>([
    ["no earned list", { unannounced: [] }],
    ["no unannounced list", { earned: ["a"] }],
    ["an earned object", { earned: { a: true }, unannounced: [] }],
  ])("treats a record with %s as corrupt", (_, value) => {
    expect(loadSave(FORMAT, stored(value))).toMatchObject({
      save: { earned: [], unannounced: [] },
      status: "corrupt",
    });
  });

  it("has the given version and starts fresh", () => {
    expect(earnedFormat(4, IDS).version).toBe(4);
    expect(FORMAT.fresh()).toEqual({ earned: [], unannounced: [] });
    expect(loadSave(FORMAT, null)).toEqual({
      save: { earned: [], unannounced: [] },
      status: "new",
    });
  });
});

// Storage whose writes each wait until released, newest first, so overlapping writes would land
// out of call order. It records every value written and the most writes held at once.
function heldStorage(entries: Map<string, string>) {
  const inner = memoryStorage(entries);
  const held: (() => void)[] = [];
  const written: EarnedRecord<Id>[] = [];
  let mostHeld = 0;
  const storage: SaveStorage = {
    read: (key) => inner.read(key),
    write: async (key, value) => {
      await new Promise<void>((resolve) => {
        held.push(resolve);
        mostHeld = Math.max(mostHeld, held.length);
      });
      written.push(JSON.parse(value) as EarnedRecord<Id>);
      await inner.write(key, value);
    },
  };
  // Releases held writes, newest first, one per macrotask.
  const drain = async () => {
    for (let turn = 0; turn < 100; turn += 1) {
      // eslint-disable-next-line no-await-in-loop -- each turn lets queued calls reach storage
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      held.pop()?.();
    }
  };
  return { drain, mostHeld: () => mostHeld, storage, written };
}

const storedRecord = (entries: Map<string, string>) => {
  const { earned, unannounced } = JSON.parse(entries.get(KEYS.save) ?? "{}");
  return { earned, unannounced };
};

describe("earnedStore", () => {
  const FORMAT = earnedFormat(1, IDS);

  it("loads a stored record, pruned", async () => {
    const entries = new Map([
      [KEYS.save, JSON.stringify({ earned: ["b", "gone"], unannounced: ["b"], version: 1 })],
    ]);
    const store = earnedStore(memoryStorage(entries), KEYS, FORMAT);
    expect(store.record()).toEqual({ earned: [], unannounced: [] });
    expect(await store.load()).toEqual({ earned: ["b"], unannounced: ["b"] });
    expect(store.record()).toEqual({ earned: ["b"], unannounced: ["b"] });
  });

  it.each<[string, readonly (readonly Id[])[], readonly (readonly Id[])[], EarnedRecord<Id>]>([
    ["one award", [["a", "b"]], [["a", "b"]], { earned: ["a", "b"], unannounced: ["a", "b"] }],
    [
      "overlapping awards",
      [
        ["a", "b"],
        ["b", "c"],
      ],
      [["a", "b"], ["c"]],
      { earned: ["a", "b", "c"], unannounced: ["a", "b", "c"] },
    ],
    ["a repeated award", [["a"], ["a"]], [["a"], []], { earned: ["a"], unannounced: ["a"] }],
  ])("applies %s and returns what each added", async (_, awards, added, record) => {
    const entries = new Map<string, string>();
    const store = earnedStore(memoryStorage(entries), KEYS, FORMAT);
    await store.load();
    const results = [];
    for (const ids of awards) {
      // eslint-disable-next-line no-await-in-loop -- each award follows the previous one
      results.push(await store.award(ids));
    }
    expect(results).toEqual(added);
    expect(store.record()).toEqual(record);
    expect(storedRecord(entries)).toEqual(record);
  });

  it("announcing removes only that id, and an unknown or repeated announcement writes nothing", async () => {
    const entries = new Map<string, string>();
    const { drain, storage, written } = heldStorage(entries);
    const store = earnedStore(storage, KEYS, FORMAT);
    const done = Promise.all([
      store.award(["a", "b", "c"]),
      store.announced("b"),
      store.announced("b"),
      store.announced("d"),
    ]);
    await drain();
    await done;
    expect(written).toEqual([
      { earned: ["a", "b", "c"], unannounced: ["a", "b", "c"], version: 1 },
      { earned: ["a", "b", "c"], unannounced: ["a", "c"], version: 1 },
    ]);
  });

  it("applies concurrent calls in call order without losing any", async () => {
    const entries = new Map([
      [KEYS.save, JSON.stringify({ earned: ["e"], unannounced: ["e"], version: 1 })],
    ]);
    const { drain, mostHeld, storage, written } = heldStorage(entries);
    const store = earnedStore(storage, KEYS, FORMAT);
    const calls = Promise.all([
      store.award(["a"]),
      store.announced("e"),
      store.award(["b", "a"]),
      store.announced("a"),
      store.award(["c"]),
      store.load(),
    ]);
    await drain();
    const [first, , second, , third, loaded] = await calls;
    expect([first, second, third]).toEqual([["a"], ["b"], ["c"]]);
    const final = { earned: ["e", "a", "b", "c"], unannounced: ["b", "c"] };
    expect(loaded).toEqual(final);
    expect(written.map(({ unannounced }) => unannounced)).toEqual([
      ["e", "a"],
      ["a"],
      ["a", "b"],
      ["b"],
      ["b", "c"],
    ]);
    expect(storedRecord(entries)).toEqual(final);
    expect(mostHeld()).toBe(1);
  });

  it("reads storage before a call made before load, so the stored record is kept", async () => {
    const entries = new Map([
      [KEYS.save, JSON.stringify({ earned: ["d"], unannounced: [], version: 1 })],
    ]);
    const store = earnedStore(memoryStorage(entries), KEYS, FORMAT);
    expect(await store.award(["a", "d"])).toEqual(["a"]);
    expect(await store.load()).toEqual({ earned: ["d", "a"], unannounced: ["a"] });
    expect(storedRecord(entries)).toEqual({ earned: ["d", "a"], unannounced: ["a"] });
  });

  it("keeps a record from a later version and plays on in memory", async () => {
    const newer = JSON.stringify({ earned: ["a"], unannounced: [], version: 2 });
    const entries = new Map([[KEYS.save, newer]]);
    const store = earnedStore(memoryStorage(entries), KEYS, FORMAT);
    expect(await store.award(["b"])).toEqual(["b"]);
    expect(store.record()).toEqual({ earned: ["b"], unannounced: ["b"] });
    expect(entries.get(KEYS.save)).toBe(newer);
  });

  it("keeps serving calls after a failed write", async () => {
    let fail = true;
    const entries = new Map<string, string>();
    const inner = memoryStorage(entries);
    const storage: SaveStorage = {
      read: (key) => inner.read(key),
      write: async (key, value) => {
        if (fail) {
          throw new Error("quota exceeded");
        }
        await inner.write(key, value);
      },
    };
    const store = earnedStore(storage, KEYS, FORMAT);
    expect(await store.award(["a"])).toEqual(["a"]);
    expect(entries.has(KEYS.save)).toBe(false);
    fail = false;
    expect(await store.award(["b"])).toEqual(["b"]);
    expect(storedRecord(entries)).toEqual({ earned: ["a", "b"], unannounced: ["a", "b"] });
  });
});

describe("CelebrationQueue", () => {
  it.each<[string, readonly (readonly Id[])[], readonly Id[]]>([
    ["in push order", [["a", "b"], ["c"]], ["a", "b", "c"]],
    [
      "without ids already waiting",
      [
        ["a", "b"],
        ["b", "a", "c"],
      ],
      ["a", "b", "c"],
    ],
    ["without repeats in one push", [["a", "a"]], ["a"]],
  ])("queues %s", (_, pushes, pending) => {
    const queue = new CelebrationQueue<Id>();
    pushes.forEach((ids) => queue.push(ids));
    expect(queue.pending()).toEqual(pending);
  });

  it("takes the oldest, then undefined when empty, and queues a taken id again", () => {
    const queue = new CelebrationQueue<Id>();
    queue.push(["a", "b"]);
    expect([queue.take(), queue.take(), queue.take()]).toEqual(["a", "b", undefined]);
    queue.push(["a"]);
    expect(queue.pending()).toEqual(["a"]);
  });

  it.each<[string, boolean, Id | undefined, readonly Id[]]>([
    ["blocked returns undefined and keeps every id", true, undefined, ["a", "b"]],
    ["unblocked takes the oldest", false, "a", ["b"]],
  ])("takeWhen %s", (_, blocked, taken, pending) => {
    const queue = new CelebrationQueue<Id>();
    queue.push(["a", "b"]);
    expect(queue.takeWhen(() => blocked)).toBe(taken);
    expect(queue.pending()).toEqual(pending);
  });

  it("does not ask blocked when nothing is waiting", () => {
    let asked = 0;
    expect(new CelebrationQueue<Id>().takeWhen(() => (asked += 1) > 0)).toBeUndefined();
    expect(asked).toBe(0);
  });

  it("returns a copy from pending", () => {
    const queue = new CelebrationQueue<Id>();
    queue.push(["a"]);
    (queue.pending() as Id[]).push("b");
    expect(queue.pending()).toEqual(["a"]);
  });
});
