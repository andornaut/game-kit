import { expect, it } from "vitest";

import {
  requestPersistentStorage,
  type StorageManagerLike,
  type StoragePersistence,
} from "./storagePersistence.ts";

// A storage manager answering persisted() and persist() with a value or a rejection, counting
// persist() calls; missing omits persist.
type Answer = "missing" | "rejects" | boolean;

function manager(persisted: Answer, persist: Answer) {
  const calls = { persist: 0 };
  const answer = (value: Answer) =>
    value === "rejects" ? Promise.reject(new Error("denied")) : Promise.resolve(value === true);
  const fake: StorageManagerLike = {
    ...(persisted === "missing" ? {} : { persisted: () => answer(persisted) }),
    ...(persist === "missing"
      ? {}
      : {
          persist: () => {
            calls.persist += 1;
            return answer(persist);
          },
        }),
  };
  return { calls, fake };
}

it.each<[string, boolean, Answer, Answer, StoragePersistence, number]>([
  ["no persist()", true, true, "missing", "unsupported", 0],
  ["storage kept already", true, true, false, "persisted", 0],
  ["a browser tab", false, false, true, "browserTab", 0],
  ["an installed app granted", true, false, true, "persisted", 1],
  ["an installed app refused", true, false, false, "bestEffort", 1],
  ["an installed app whose persist() rejects", true, false, "rejects", "bestEffort", 1],
  ["a persisted() that rejects", true, "rejects", true, "persisted", 1],
  ["no persisted()", true, "missing", false, "bestEffort", 1],
])("answers %s", async (_, installed, persisted, persist, expected, persistCalls) => {
  const { calls, fake } = manager(persisted, persist);
  await expect(requestPersistentStorage(installed, fake)).resolves.toBe(expected);
  expect(calls.persist).toBe(persistCalls);
});

it("answers unsupported without a storage manager", async () => {
  await expect(requestPersistentStorage(true, undefined)).resolves.toBe("unsupported");
});
