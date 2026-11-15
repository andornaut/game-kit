export type GroupSnapshot = Readonly<Record<string, readonly string[]>>;

export interface GroupFreeze {
  readonly activating: boolean;
  readonly snapshot: GroupSnapshot;
}

export interface GroupStore {
  close(): void;
  commit(build: string, ids: readonly string[], token?: string): Promise<"stored" | "blocked">;
  finishActivation(ownerBuild: string): Promise<void>;
  freeze(ownerBuild: string, token: string, deadline: number): Promise<GroupFreeze | undefined>;
  markActivating(token: string): Promise<boolean>;
  read(build: string): Promise<readonly string[] | undefined>;
  release(token: string): Promise<void>;
  remove(build: string): Promise<void>;
  snapshot(): Promise<GroupSnapshot>;
}

interface Barrier {
  deadline: number;
  ownerBuild: string;
  phase: "pending" | "activating";
  token: string;
}

interface StoredState {
  barrier?: Barrier;
  groups: [string, string[]][];
}

const STORE = "state";
const KEY = "groups";

function decode(value: unknown): StoredState {
  if (value === undefined) {
    return { groups: [] };
  }
  const invalid = () => new Error("Invalid durable group state");
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, "groups")) {
    throw invalid();
  }
  const state = value as StoredState;
  if (!Array.isArray(state.groups)) {
    throw invalid();
  }
  const builds = new Set<string>();
  for (const entry of state.groups) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !Array.isArray(entry[1]) ||
      [...entry[1]].some((id: unknown) => typeof id !== "string") ||
      builds.has(entry[0])
    ) {
      throw invalid();
    }
    builds.add(entry[0]);
  }
  if (Object.hasOwn(state, "barrier")) {
    const barrier = state.barrier;
    if (
      barrier === null ||
      typeof barrier !== "object" ||
      !["deadline", "ownerBuild", "phase", "token"].every((key) => Object.hasOwn(barrier, key)) ||
      !Number.isFinite(barrier.deadline) ||
      typeof barrier.ownerBuild !== "string" ||
      typeof barrier.token !== "string" ||
      (barrier.phase !== "pending" && barrier.phase !== "activating")
    ) {
      throw invalid();
    }
  }
  return state;
}

function snapshot(state: StoredState): GroupSnapshot {
  return Object.fromEntries(state.groups.map(([build, ids]) => [build, [...ids]]));
}

// Private durable metadata only. Call commit after every cache write for these groups succeeds.
// All writers share one transaction scope, including the barrier and read/union/write sequence.
// Pending barriers expire. Activating intent stays fenced; its owner can refresh the retry token
// without releasing the fence. Only matching release or owner activation clears that intent.
export function createGroupStore(
  context: { readonly indexedDB: IDBFactory | undefined; readonly now: () => number },
  databaseName: string,
): GroupStore {
  let connection: Promise<IDBDatabase> | undefined;
  let closed = false;
  const open = (): Promise<IDBDatabase> => {
    if (closed) {
      return Promise.reject(new Error("Group store is closed"));
    }
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (context.indexedDB === undefined) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = context.indexedDB.open(databaseName, 1);
      let rejected = false;
      request.onblocked = () => {
        rejected = true;
        reject(new Error("Group store open is blocked"));
      };
      request.onerror = () => reject(request.error ?? new Error("Group store open failed"));
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        if (rejected || closed) {
          database.close();
          reject(new Error("Group store is closed"));
          return;
        }
        database.onversionchange = () => {
          closed = true;
          database.close();
        };
        resolve(database);
      };
    });
    return connection;
  };
  const transact = async <T>(
    mode: IDBTransactionMode,
    operation: (state: StoredState) => T,
  ): Promise<T> => {
    const database = await open();
    if (closed) {
      throw new Error("Group store is closed");
    }
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode, { durability: "strict" });
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? new Error("Group store transaction aborted"));
      const store = transaction.objectStore(STORE);
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          const state = decode(request.result);
          result = operation(state);
          if (mode === "readwrite") {
            store.put(state, KEY);
          }
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    });
  };
  const clock = (): number => {
    const time = context.now();
    if (!Number.isFinite(time)) {
      throw new RangeError("Group store clock must be finite");
    }
    return time;
  };
  const currentBarrier = (state: StoredState, time = clock()): Barrier | undefined => {
    if (state.barrier?.phase === "pending" && time >= state.barrier.deadline) {
      delete state.barrier;
    }
    return state.barrier;
  };

  return {
    close() {
      closed = true;
      void connection?.then(
        (database) => database.close(),
        () => {},
      );
    },
    commit(build, ids, token) {
      // Copy caller data before opening a database or yielding to another writer.
      const addition = [...ids];
      return transact("readwrite", (state) => {
        if (typeof build !== "string" || addition.some((id) => typeof id !== "string")) {
          throw new TypeError("Group build and IDs must be strings");
        }
        const barrier = currentBarrier(state);
        if (barrier !== undefined && (barrier.ownerBuild !== build || barrier.token !== token)) {
          return "blocked";
        }
        const groups = new Map(state.groups);
        groups.set(build, [...new Set([...(groups.get(build) ?? []), ...addition])]);
        state.groups = [...groups];
        return "stored";
      });
    },
    finishActivation(ownerBuild) {
      return transact("readwrite", (state) => {
        if (state.barrier?.ownerBuild === ownerBuild) {
          delete state.barrier;
        }
      });
    },
    freeze(ownerBuild, token, deadline) {
      return transact("readwrite", (state) => {
        if (
          typeof ownerBuild !== "string" ||
          typeof token !== "string" ||
          !Number.isFinite(deadline)
        ) {
          throw new TypeError("Invalid group freeze owner, token or deadline");
        }
        const time = clock();
        const barrier = currentBarrier(state, time);
        if (deadline <= time) {
          return undefined;
        }
        if (barrier !== undefined) {
          if (barrier.phase !== "activating" || barrier.ownerBuild !== ownerBuild) {
            return undefined;
          }
          barrier.deadline = deadline;
          barrier.token = token;
          return { activating: true, snapshot: snapshot(state) };
        }
        state.barrier = { deadline, ownerBuild, phase: "pending", token };
        return { activating: false, snapshot: snapshot(state) };
      });
    },
    markActivating(token) {
      return transact("readwrite", (state) => {
        const time = clock();
        const barrier = currentBarrier(state, time);
        if (barrier === undefined || barrier.token !== token || barrier.deadline <= time) {
          return false;
        }
        barrier.phase = "activating";
        return true;
      });
    },
    read(build) {
      return transact("readonly", (state) => new Map(state.groups).get(build));
    },
    release(token) {
      return transact("readwrite", (state) => {
        if (state.barrier?.token === token) {
          delete state.barrier;
        }
      });
    },
    remove(build) {
      return transact("readwrite", (state) => {
        state.groups = state.groups.filter(([key]) => key !== build);
      });
    },
    snapshot() {
      return transact("readonly", snapshot);
    },
  };
}
