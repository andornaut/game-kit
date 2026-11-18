import { expect, it, vi } from "vitest";

import { ACTIVATING_GRACE_MS, createGroupStore } from "./groupStore.ts";

const context = (indexedDB: IDBFactory | undefined) => ({ indexedDB, now: () => 0 });

it("does not open IndexedDB on construction or close, including legacy without a factory", async () => {
  const open = vi.fn();
  const unused = createGroupStore(context({ open } as unknown as IDBFactory), "unused");
  unused.close();
  expect(open).not.toHaveBeenCalled();
  const missing = createGroupStore(context(undefined), "missing");
  await expect(missing.read("build")).rejects.toThrow("IndexedDB is unavailable");
  await expect(missing.commit("build", [])).rejects.toThrow("IndexedDB is unavailable");
  await expect(missing.freeze("new", "token", 1)).rejects.toThrow("IndexedDB is unavailable");
  missing.close();
});

it("rejects denied opens without creating an in-memory durable record", async () => {
  const failure = new Error("Storage access denied");
  const open = vi.fn(() => {
    throw failure;
  });
  const store = createGroupStore(context({ open } as unknown as IDBFactory), "denied");
  await expect(store.commit("build", ["ui"])).rejects.toBe(failure);
  await expect(store.snapshot()).rejects.toBe(failure);
  expect(open).toHaveBeenCalledTimes(2);
  store.close();
});

function opening() {
  const close = vi.fn();
  const transaction = vi.fn();
  const request = {
    error: new Error("Open failed"),
    onblocked: () => {},
    onerror: () => {},
    onsuccess: () => {},
    result: { close, transaction },
  };
  const open = vi.fn(() => request);
  const store = createGroupStore(context({ open } as unknown as IDBFactory), "opening");
  return { close, open, request, store, transaction };
}

it("retries blocked opens and closes stale late success without replacing the new connection", async () => {
  const target = opening();
  const failure = new Error("New connection schema unavailable");
  const next = {
    ...target.request,
    result: {
      close: vi.fn(),
      transaction: vi.fn(() => {
        throw failure;
      }),
    },
  };
  target.open.mockReturnValueOnce(target.request).mockReturnValueOnce(next);
  const pending = target.store.freeze("next", "token", 1);
  target.request.onblocked();
  await expect(pending).rejects.toThrow("open is blocked");
  const retry = target.store.read("build");
  target.request.onsuccess();
  next.onsuccess();
  await expect(retry).rejects.toBe(failure);
  expect(target.open).toHaveBeenCalledTimes(2);
  expect(target.close).toHaveBeenCalledOnce();
  expect(target.transaction).not.toHaveBeenCalled();
  expect(next.result.transaction).toHaveBeenCalledOnce();
  target.store.close();
});

it("rejects explicit open errors and a close while opening without starting a transaction", async () => {
  const failed = opening();
  const first = failed.store.read("build");
  failed.request.onerror();
  await expect(first).rejects.toBe(failed.request.error);
  failed.store.close();
  const closed = opening();
  const second = closed.store.read("build");
  closed.store.close();
  closed.request.onsuccess();
  await expect(second).rejects.toThrow("closed");
  expect(closed.close).toHaveBeenCalledOnce();
  expect(closed.transaction).not.toHaveBeenCalled();
});

it("rejects broken schema access instead of returning an empty successful snapshot", async () => {
  const target = opening();
  const error = new Error("Missing object store");
  target.transaction.mockImplementation(() => {
    throw error;
  });
  const pending = target.store.snapshot();
  target.request.onsuccess();
  await expect(pending).rejects.toBe(error);
  target.store.close();
});

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: unknown, expected: unknown, message: string) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

async function writeNativeState(indexedDB: IDBFactory, name: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("state", "readwrite");
      transaction.objectStore("state").put(value, "groups");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

// Executed by the isolated native browser fixture, never by a substitute IDB implementation.
export async function proveNativeGroupStore(indexedDB: IDBFactory): Promise<readonly string[]> {
  const passed: string[] = [];
  let time = 100;
  const settings = { indexedDB, now: () => time };
  const name = "group-store-native-proof";
  const first = createGroupStore(settings, name);
  const second = createGroupStore(settings, name);
  try {
    let opens = 0;
    const retrying = createGroupStore(
      {
        indexedDB: {
          open(database: string, version?: number) {
            opens += 1;
            if (opens === 1) {
              throw new Error("Temporary storage denial");
            }
            return indexedDB.open(database, version);
          },
        } as IDBFactory,
        now: settings.now,
      },
      `${name}-retry`,
    );
    try {
      const failed = await retrying.commit("build", ["ui"]).then(
        () => false,
        () => true,
      );
      check(failed, "transient open denial must reject without reporting stored");
      same(
        await retrying.commit("build", ["ui"]),
        "stored",
        "explicit retry reopens native IndexedDB",
      );
      same(await retrying.read("build"), ["ui"], "reopened native connection persists groups");
      same(opens, 2, "successful native connection is retained after recovery");
      passed.push("explicit retry after transient open denial uses a real native connection");
    } finally {
      retrying.close();
    }
    same(await first.read("old"), undefined, "absent build must differ from committed base");
    await first.commit("old", []);
    same(await first.read("old"), [], "empty group set records committed base");
    const outcomes = await Promise.all([
      first.commit("old", ["ui"]),
      second.commit("old", ["audio", "ui"]),
      first.commit("old", ["world"]),
    ]);
    same(outcomes, ["stored", "stored", "stored"], "concurrent writers must all store");
    same([...(await first.read("old"))!].sort(), ["audio", "ui", "world"], "transactional union");
    passed.push("cross-connection transactional union and committed empty base");

    await first.commit("__proto__", ["constructor"]);
    await first.commit("constructor", ["__proto__"]);
    const record = await second.snapshot();
    check(Object.hasOwn(record, "__proto__"), "snapshot must retain own special build keys");
    same(record.__proto__, ["constructor"], "special build IDs must not mutate prototypes");
    same(record.constructor, ["__proto__"], "inherited names must be independent builds");
    passed.push("own-property snapshot and special build/group IDs");

    const complete = await first.snapshot();
    const [before, blocked] = await Promise.all([
      first.freeze("next", "lease", 200),
      second.commit("old", ["late"]),
    ]);
    check(before !== undefined, "freeze must acquire a barrier");
    same(
      before,
      { activating: false, snapshot: complete },
      "freeze returns exact complete records and phase",
    );
    same(blocked, "blocked", "freeze must fence another connection's queued commit");
    same(await first.commit("next", ["ui"]), "blocked", "owner requires matching token");
    same(await first.commit("old", ["late"], "lease"), "blocked", "token requires matching owner");
    same(await first.commit("next", [], "lease"), "stored", "owner may commit base under lease");
    same(
      await second.freeze("other", "other", 300),
      undefined,
      "second freeze cannot steal barrier",
    );
    same(
      await second.freeze("next", "other", 300),
      undefined,
      "pending owner cannot steal its active attempt",
    );
    await second.release("wrong");
    same(await second.commit("old", ["late"]), "blocked", "wrong release cannot clear barrier");
    passed.push("atomic freeze snapshot and owner/token fencing");

    time = 200;
    same(
      await second.markActivating("lease"),
      false,
      "expired pending token cannot mark activating",
    );
    same(await second.commit("old", ["late"]), "stored", "pending lease expires at deadline");
    same(await first.freeze("next", "expired", 200), undefined, "cannot create expired barrier");
    check((await first.freeze("next", "durable", 250)) !== undefined, "new pending barrier");
    same(await second.markActivating("wrong"), false, "wrong activation token is rejected");
    same(
      await second.markActivating("durable"),
      true,
      "live pending token records activation intent",
    );
    first.close();
    second.close();
    time = 10000;
    const resumed = createGroupStore(settings, name);
    try {
      same(
        await resumed.commit("old", ["forbidden"]),
        "blocked",
        "activating intent cannot expire",
      );
      same(
        await resumed.freeze("other", "steal", 20000),
        undefined,
        "cannot replace activating intent",
      );
      same(
        await resumed.markActivating("durable"),
        false,
        "expired activating token cannot skip again",
      );
      const recovery = await resumed.freeze("next", "recovery", 11000);
      check(recovery?.activating === true, "same owner resumes interrupted activation intent");
      same(recovery.snapshot, await resumed.snapshot(), "recovery returns durable complete groups");
      await resumed.release("durable");
      same(
        await resumed.commit("old", ["forbidden"]),
        "blocked",
        "superseded token cannot clear intent",
      );
      same(await resumed.markActivating("durable"), false, "superseded token cannot activate");
      same(
        await resumed.markActivating("recovery"),
        true,
        "fresh matching recovered token may activate",
      );
      time = 12000;
      same(await resumed.markActivating("recovery"), false, "recovered deadline is enforced");
      same(
        await resumed.commit("old", []),
        "blocked",
        "expiry never unfences recovered activating intent",
      );
      await resumed.finishActivation("wrong-build");
      same(
        await resumed.commit("old", []),
        "blocked",
        "wrong activate handler cannot release intent",
      );
      await resumed.finishActivation("next");
      same(await resumed.commit("old", ["after"]), "stored", "matching new worker clears intent");
      passed.push("pending expiry and durable activating intent across connection restart");
      passed.push("same-owner interrupted activation recovery without an unfenced commit window");

      check((await resumed.freeze("next", "rollback", 20000)) !== undefined, "rollback barrier");
      same(await resumed.markActivating("rollback"), true, "rollback activation intent");
      await resumed.release("wrong");
      same(await resumed.commit("old", []), "blocked", "wrong rollback token remains fenced");
      await resumed.release("rollback");
      same(await resumed.commit("old", []), "stored", "explicit matching token releases intent");

      check((await resumed.freeze("next", "orphan", 30000)) !== undefined, "orphan barrier");
      same(await resumed.markActivating("orphan"), true, "orphan activation intent");
      time = 30000 + ACTIVATING_GRACE_MS - 1;
      same(await resumed.commit("old", []), "blocked", "activating intent holds through its grace");
      time = 30000 + ACTIVATING_GRACE_MS;
      same(
        await resumed.commit("old", []),
        "stored",
        "a replaced owner's activating intent expires after its grace",
      );
      await resumed.remove("__proto__");
      same(await resumed.read("__proto__"), undefined, "remove deletes only selected build");
      same(await resumed.read("constructor"), ["__proto__"], "other special build retained");
      passed.push("explicit activation rollback and isolated build removal");

      time = NaN;
      let rejected = false;
      try {
        await resumed.commit("old", ["uncommitted"]);
      } catch {
        rejected = true;
      }
      check(rejected, "invalid clock must reject the transaction");
      check(
        !(await resumed.read("old"))!.includes("uncommitted"),
        "aborted union must not persist",
      );
      passed.push("native transaction abort rejects without recording ready groups");

      time = 10000;
      await writeNativeState(indexedDB, name, {
        barrier: { phase: "activating" },
        groups: [["old", ["ui"]]],
      });
      const outcomes = await Promise.all(
        [
          () => resumed.read("old"),
          () => resumed.commit("old", ["must-not-store"]),
          () => resumed.freeze("next", "must-not-acquire", 20000),
          () => resumed.finishActivation("next"),
        ].map((operation) =>
          operation().then(
            () => false,
            () => true,
          ),
        ),
      );
      check(
        outcomes.every(Boolean),
        "broken durable barrier must fail closed without overwriting it",
      );
      passed.push("corrupt persisted activation barrier rejects reads and mutations");
    } finally {
      resumed.close();
    }
  } finally {
    first.close();
    second.close();
  }
  return passed;
}
