// Achievements: a game's catalogue of badges, each earned once when all of its conditions hold.
// The game owns the condition union, its evaluators, the scopes and facts they are judged at,
// tiers, strings, art and storage keys. This module judges conditions, orders and awards
// badges, keeps the earned record in its own versioned save and queues unlock notices.
import {
  type SaveKeys,
  saveStore,
  type StoreLoadResult,
  type StoreSaveResult,
} from "./save/saveStore.ts";
import type { SaveStorage } from "./save/storage.ts";
import type { Checked, SaveFormat, StoredObject } from "./save/versionedSave.ts";

// A badge. It carries no display strings: a game extends it with its own presentation fields.
export interface AchievementDef<
  Id extends string,
  Cond extends { readonly kind: string },
  Tier extends string,
> {
  readonly id: Id;
  readonly tier: Tier;
  // All must hold, at the same scope and facts, for the badge to be earned.
  readonly conditions: readonly [Cond, ...Cond[]];
}

// How far a condition has come: have is between 0 and need.
export interface Progress {
  readonly have: number;
  readonly need: number;
}

// The evaluator for one condition kind. It is judged only at scopes, and never holds elsewhere.
// progress, when present, reports how far facts have come toward the condition for display; it
// does not affect whether the condition holds.
export interface ConditionKind<Cond, Scope extends string, Facts> {
  readonly scopes: readonly Scope[];
  readonly holds: (facts: Facts, condition: Cond) => boolean;
  readonly progress?: (facts: Facts, condition: Cond) => Progress;
}

// One evaluator for every kind in the condition union.
export type ConditionKinds<Cond extends { readonly kind: string }, Scope extends string, Facts> = {
  readonly [K in Cond["kind"]]: ConditionKind<Extract<Cond, { readonly kind: K }>, Scope, Facts>;
};

export interface Judge<Cond, Scope extends string, Facts> {
  // Whether condition holds for facts at scope: false at a scope its kind does not list.
  holds(scope: Scope, facts: Facts, condition: Cond): boolean;
  // The progress of the condition furthest from done among conditions whose kind has progress:
  // the minimum have/need fraction, the first such condition on a tie, with have clamped to
  // between 0 and need (a need of 0 or less counts as done). undefined when no condition's kind
  // has progress. It is never full unless every condition holds at scope: a full result is then
  // reported one short, as { have: need - 1, need } for a need of 1 or more, { have: 0, need }
  // for a need between 0 and 1, and { have: 0, need: 1 } for a need of 0 or less.
  progress(scope: Scope, facts: Facts, conditions: readonly Cond[]): Progress | undefined;
}

function kindOf<Cond extends { readonly kind: string }, Scope extends string, Facts>(
  kinds: ConditionKinds<Cond, Scope, Facts>,
  condition: Cond,
): ConditionKind<Cond, Scope, Facts> {
  if (!Object.hasOwn(kinds, condition.kind)) {
    throw new RangeError(`No condition kind is registered for "${condition.kind}"`);
  }
  // Each entry evaluates exactly the conditions of its own kind.
  return kinds[condition.kind as Cond["kind"]] as unknown as ConditionKind<Cond, Scope, Facts>;
}

function clamped({ have, need }: Progress): Progress {
  return { have: Math.max(0, Math.min(have, need)), need };
}

function fraction({ have, need }: Progress): number {
  return need <= 0 ? 1 : have / need;
}

function isFull({ have, need }: Progress): boolean {
  return need <= 0 || have >= need;
}

// progress one short of full.
function short({ need }: Progress): Progress {
  return need > 0 ? { have: Math.max(0, need - 1), need } : { have: 0, need: 1 };
}

// A judge built from one registry. A condition whose kind is not registered throws RangeError.
export function judge<Cond extends { readonly kind: string }, Scope extends string, Facts>(
  kinds: ConditionKinds<Cond, Scope, Facts>,
): Judge<Cond, Scope, Facts> {
  const holds = (scope: Scope, facts: Facts, condition: Cond): boolean => {
    const kind = kindOf(kinds, condition);
    return kind.scopes.includes(scope) && kind.holds(facts, condition);
  };
  return {
    holds,
    progress(scope, facts, conditions) {
      let least: Progress | undefined;
      for (const condition of conditions) {
        const kind = kindOf(kinds, condition);
        if (kind.progress === undefined) {
          continue;
        }
        const next = clamped(kind.progress(facts, condition));
        if (least === undefined || fraction(next) < fraction(least)) {
          least = next;
        }
      }
      if (
        least !== undefined &&
        isFull(least) &&
        !conditions.every((condition) => holds(scope, facts, condition))
      ) {
        return short(least);
      }
      return least;
    },
  };
}

// A count, or "all" of something the caller counts.
export type Threshold = number | "all";

// The count threshold asks for, out of all.
export function resolveThreshold(all: number, threshold: Threshold): number {
  return threshold === "all" ? all : threshold;
}

// defs in the order of their tiers in tiers, keeping authored order within a tier. Apply it once
// to the catalogue; newlyEarned keeps catalogue order. Throws RangeError for a tier that tiers
// does not list.
export function orderByTier<Tier extends string, T extends { readonly tier: Tier }>(
  tiers: readonly Tier[],
  defs: readonly T[],
): T[] {
  const rank = (def: T): number => {
    const index = tiers.indexOf(def.tier);
    if (index < 0) {
      throw new RangeError(`Tier "${def.tier}" is not in the tier order`);
    }
    return index;
  };
  return defs
    .map((def, index) => ({ def, index, rank: rank(def) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ def }) => def);
}

// The ids in catalogue whose every condition holds at scope for facts and that earned does not
// hold, in catalogue order, each once.
export function newlyEarned<
  Id extends string,
  Cond extends { readonly kind: string },
  Scope extends string,
  Facts,
>(
  judge: Judge<Cond, Scope, Facts>,
  catalogue: readonly AchievementDef<Id, Cond, string>[],
  scope: Scope,
  facts: Facts,
  earned: readonly Id[],
): Id[] {
  const seen = new Set<Id>(earned);
  const fresh: Id[] = [];
  for (const { conditions, id } of catalogue) {
    if (!seen.has(id) && conditions.every((condition) => judge.holds(scope, facts, condition))) {
      seen.add(id);
      fresh.push(id);
    }
  }
  return fresh;
}

// earned followed by each of ids it does not hold yet, in ids order, each once. Returns earned
// itself when nothing is added.
export function award<Id>(ids: readonly Id[], earned: readonly Id[]): readonly Id[] {
  const seen = new Set<Id>(earned);
  const added: Id[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      added.push(id);
    }
  }
  return added.length === 0 ? earned : [...earned, ...added];
}

// The elements of stored that are in known, in stored order, each once: an empty list when
// stored is not an array.
export function keepKnown<Id>(known: readonly Id[], stored: unknown): Id[] {
  if (!Array.isArray(stored)) {
    return [];
  }
  const allowed = new Set<unknown>(known);
  const kept = new Set<Id>();
  for (const value of stored) {
    if (allowed.has(value)) {
      kept.add(value as Id);
    }
  }
  return [...kept];
}

// The earned badges, in award order, and those of them not announced yet, also in award order.
export interface EarnedRecord<Id> {
  readonly earned: readonly Id[];
  readonly unannounced: readonly Id[];
}

const FRESH_RECORD: EarnedRecord<never> = { earned: [], unannounced: [] };

// The earned record's save format at version, kept apart from the game's main save so that
// resetting progress does not clear it. Loading drops ids not in known, duplicates and
// unannounced ids that are not earned; a record whose earned or unannounced field is not an
// array is corrupt. It has no migrations: a game that changes the record adds them with
// { ...earnedFormat(version, known), migrations }.
export function earnedFormat<Id extends string>(
  version: number,
  known: readonly Id[],
): SaveFormat<EarnedRecord<Id>> {
  return {
    decode(stored: StoredObject): Checked<EarnedRecord<Id>> {
      if (!Array.isArray(stored.earned) || !Array.isArray(stored.unannounced)) {
        return { ok: false, reason: "the record has no earned and unannounced lists" };
      }
      const earned = keepKnown(known, stored.earned);
      return { ok: true, value: { earned, unannounced: keepKnown(earned, stored.unannounced) } };
    },
    encode: ({ earned, unannounced }) => ({
      ok: true,
      value: { earned: [...earned], unannounced: [...unannounced] },
    }),
    fresh: () => FRESH_RECORD,
    migrations: {},
    version,
  };
}

// The ids an award added, in award order, and the status of the write that stored them:
// undefined when nothing was added, so nothing was written.
export interface AwardResult<Id> {
  readonly added: readonly Id[];
  readonly save: StoreSaveResult | undefined;
}

// The earned record, held in memory and written through a save store. Calls run one at a time
// in call order, each on the record the previous one left, so concurrent calls lose nothing.
// The first call of any kind reads storage. Storage failures, a corrupt record and a record
// from a later version follow saveStore: the record plays on in memory, writes stop when
// saveStore stops them, and each status is reported as saveStore reports it.
export interface EarnedStore<Id> {
  // The first read's status and reason, with the record as every earlier call has left it as
  // save.
  load(): Promise<StoreLoadResult<EarnedRecord<Id>>>;
  // The record as the calls applied so far have left it: fresh before the first read.
  record(): EarnedRecord<Id>;
  // Appends the ids not yet earned to earned and to unannounced, writes the record if any were
  // added, and resolves to them with the write's status.
  award(ids: readonly Id[]): Promise<AwardResult<Id>>;
  // Removes id from unannounced and writes the record, resolving to the write's status:
  // undefined, with nothing written, when id was not unannounced.
  announced(id: Id): Promise<StoreSaveResult | undefined>;
}

export function earnedStore<Id extends string>(
  storage: SaveStorage,
  keys: SaveKeys,
  format: SaveFormat<EarnedRecord<Id>>,
): EarnedStore<Id> {
  const store = saveStore(storage, keys, format);
  let current: EarnedRecord<Id> = format.fresh();
  // The first read, which sets current when it resolves, or undefined before it starts.
  let loaded: Promise<StoreLoadResult<EarnedRecord<Id>>> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  // Runs operation after every earlier one, on the loaded record, with the first read's result.
  const enqueue = <T>(
    operation: (first: StoreLoadResult<EarnedRecord<Id>>) => Promise<T> | T,
  ): Promise<T> => {
    const next = queue.then(async () => {
      loaded ??= store.load().then((result) => {
        current = result.save;
        return result;
      });
      return operation(await loaded);
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const write = (next: EarnedRecord<Id>): Promise<StoreSaveResult> => {
    current = next;
    return store.save(next);
  };

  return {
    announced: (id) =>
      enqueue(async () => {
        if (!current.unannounced.includes(id)) {
          return undefined;
        }
        return write({
          earned: current.earned,
          unannounced: current.unannounced.filter((pending) => pending !== id),
        });
      }),
    award: (ids) =>
      enqueue(async () => {
        const earned = award(ids, current.earned);
        const added = earned.slice(current.earned.length);
        if (added.length === 0) {
          return { added, save: undefined };
        }
        const save = await write({ earned, unannounced: [...current.unannounced, ...added] });
        return { added, save };
      }),
    load: () => enqueue((first) => ({ ...first, save: current })),
    record: () => current,
  };
}

// Unlock notices waiting to show, in push order, each id at most once while it waits.
export class CelebrationQueue<Id> {
  readonly #pending: Id[] = [];

  // Queues each of ids that is not already waiting.
  push(ids: readonly Id[]): void {
    for (const id of ids) {
      if (!this.#pending.includes(id)) {
        this.#pending.push(id);
      }
    }
  }

  // Removes and returns the oldest waiting id: undefined when none is waiting.
  take(): Id | undefined {
    return this.#pending.shift();
  }

  // take() unless blocked() is true, when it returns undefined and keeps every id waiting.
  // blocked is not called when nothing is waiting.
  takeWhen(blocked: () => boolean): Id | undefined {
    if (this.#pending.length === 0 || blocked()) {
      return undefined;
    }
    return this.take();
  }

  // The waiting ids, oldest first.
  pending(): readonly Id[] {
    return [...this.#pending];
  }
}
