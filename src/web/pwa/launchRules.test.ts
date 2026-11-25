import { describe, expect, it } from "vitest";

import type { BuildManifest, BuildPointer } from "./buildContract.ts";
import {
  bootBytesOf,
  canPublishStaged,
  failureReason,
  groupedManifestMismatch,
  launchProgress,
  nextUpdateRetryMs,
  parseProgressCarry,
  progressCarryText,
  requiredUpdateCandidate,
  sameDeployedGroups,
  sameUpdateState,
  UPDATE_CHECK_MS,
  UPDATE_RETRY_MAX_MS,
  UPDATE_RETRY_MS,
  updateCheckWait,
} from "./launchRules.ts";

const file = (url: string, byteSize: number) => ({ byteSize, sha256: "0".repeat(64), url });
const manifest = (files: BuildManifest["files"], boot: readonly string[] = []) =>
  ({ boot, buildId: "b1", files, schema: 1, sounds: {}, version: "v1" }) as BuildManifest;

describe("failureReason", () => {
  it("keeps a first-install reason and treats anything else as a network failure", () => {
    expect(failureReason({ reason: "quota" })).toBe("quota");
    expect(failureReason({ reason: "unsupported" })).toBe("unsupported");
    expect(failureReason({ reason: "verification" })).toBe("verification");
    expect(failureReason({ reason: "disk" })).toBe("network");
    expect(failureReason(null)).toBe("network");
  });
});

it("counts each boot file once at its manifest size", () => {
  expect(
    bootBytesOf(manifest([file("/a.js", 3), file("/b.js", 5)], ["/a.js", "/a.js", "/c"])),
  ).toBe(3);
});

describe("launchProgress", () => {
  const counts = { bootBytes: 100, received: 0, recorded: false, total: 300 };

  it("spreads one value over download and boot bytes, holding back the record share", () => {
    expect(launchProgress({ ...counts, received: 300 }, 0, "installing", 0)).toEqual({
      phase: "installing",
      receivedBytes: 300,
      totalBytes: 400,
      value: 0.99 * 0.75,
    });
    expect(
      launchProgress({ ...counts, received: 300, recorded: true }, 0, "booting", 0.5).value,
    ).toBeCloseTo(0.99 * 0.875 + 0.01);
  });

  it("never decreases and reaches 1 only when ready", () => {
    expect(launchProgress(counts, 0.5, "installing", 0).value).toBe(0.5);
    const booted = { ...counts, received: 300, recorded: true };
    expect(launchProgress(booted, 0, "booting", 1).value).toBe(1 - Number.EPSILON);
    expect(launchProgress(booted, 0, "ready", 1)).toMatchObject({ receivedBytes: 400, value: 1 });
  });

  it("uses the boot fraction alone when there are no bytes", () => {
    expect(launchProgress({ ...counts, bootBytes: 0, total: 0 }, 0, "booting", 0.5).value).toBe(
      0.99 * 0.5,
    );
  });
});

describe("progress carry", () => {
  it("round-trips through its session text", () => {
    const carry = { bootBytes: 10, receivedBytes: 20, version: "v1" };
    expect(progressCarryText(carry)).toBe('{"bootBytes":10,"receivedBytes":20,"version":"v1"}');
    expect(parseProgressCarry(progressCarryText(carry))).toEqual(carry);
  });

  it.each([null, undefined, "", "{", '{"version":1,"receivedBytes":2,"bootBytes":3}'])(
    "rejects %j",
    (text) => {
      expect(parseProgressCarry(text)).toBeUndefined();
    },
  );

  it("rejects non-finite byte counts", () => {
    expect(parseProgressCarry('{"version":"v1","receivedBytes":null,"bootBytes":3}')).toBe(
      undefined,
    );
  });
});

it("doubles the update retry wait from UPDATE_RETRY_MS up to UPDATE_RETRY_MAX_MS", () => {
  expect(nextUpdateRetryMs(0)).toBe(UPDATE_RETRY_MS);
  expect(nextUpdateRetryMs(UPDATE_RETRY_MS)).toBe(2 * UPDATE_RETRY_MS);
  expect(nextUpdateRetryMs(UPDATE_RETRY_MAX_MS - 1)).toBe(UPDATE_RETRY_MAX_MS);
});

it("waits out UPDATE_CHECK_MS after the last check", () => {
  expect(updateCheckWait(5_000, undefined)).toBe(0);
  expect(updateCheckWait(5_000, 1_000)).toBe(UPDATE_CHECK_MS - 4_000);
  expect(updateCheckWait(1_000 + UPDATE_CHECK_MS, 1_000)).toBe(0);
});

it("compares update states by phase, version and value", () => {
  expect(sameUpdateState({ phase: "idle" }, { phase: "idle" })).toBe(true);
  expect(
    sameUpdateState(
      { phase: "staging", value: 0.5, version: "v2" },
      { phase: "staging", value: 0.5, version: "v2" },
    ),
  ).toBe(true);
  expect(
    sameUpdateState(
      { phase: "staging", value: 0.5, version: "v2" },
      { phase: "staging", value: 0.6, version: "v2" },
    ),
  ).toBe(false);
  expect(
    sameUpdateState({ phase: "ready", version: "v2" }, { phase: "failed", version: "v2" }),
  ).toBe(false);
  expect(
    sameUpdateState({ phase: "ready", version: "v2" }, { phase: "ready", version: "v3" }),
  ).toBe(false);
});

describe("sameDeployedGroups", () => {
  const group = (sha: string) => ({ byteSize: 4, schema: 1, sha256: sha.repeat(64) });
  const pointer = {
    buildId: "b1",
    groupedFirstInstall: true,
    groups: [group("a"), group("b")],
    version: "v1",
  } as unknown as BuildPointer;

  it("accepts the same version, build, install mode and groups", () => {
    expect(
      sameDeployedGroups(pointer, {
        ...pointer,
        groups: [group("a"), group("b")],
      } as unknown as BuildPointer),
    ).toBe(true);
  });

  it.each<[string, object]>([
    ["version", { version: "v2" }],
    ["build", { buildId: "b2" }],
    ["install mode", { groupedFirstInstall: undefined }],
    ["group count", { groups: [group("a")] }],
    ["group digest", { groups: [group("a"), group("c")] }],
  ])("rejects a changed %s", (_name, change) => {
    expect(sameDeployedGroups(pointer, { ...pointer, ...change } as unknown as BuildPointer)).toBe(
      false,
    );
  });
});

describe("groupedManifestMismatch", () => {
  const deployed = manifest([file("/a.js", 3), file("/b.png", 5)]);

  it("accepts members that hold exactly the deployed files", () => {
    const members = new Map([
      ["/a.js", { byteSize: 3 }],
      ["/b.png", { byteSize: 5 }],
    ]);
    expect(groupedManifestMismatch(undefined, deployed, members)).toBeUndefined();
  });

  it("names a member of another size and a missing file", () => {
    expect(
      groupedManifestMismatch(
        undefined,
        deployed,
        new Map([
          ["/a.js", { byteSize: 4 }],
          ["/b.png", { byteSize: 5 }],
        ]),
      ),
    ).toBe("Grouped build member does not match /a.js");
    expect(
      groupedManifestMismatch(undefined, deployed, new Map([["/a.js", { byteSize: 3 }]])),
    ).toBe("Grouped build member is missing for /b.png");
  });
});

describe("canPublishStaged", () => {
  it("publishes while no other context changed the records", () => {
    expect(canPublishStaged({ active: "v1" }, { active: "v1" }, "v2")).toBe(true);
    expect(canPublishStaged({ active: "v1" }, { active: "v1", staged: "v2" }, "v2")).toBe(true);
  });

  it("refuses once the version is active, another is active or another is staged", () => {
    expect(canPublishStaged({ active: "v1" }, { active: "v2" }, "v2")).toBe(false);
    expect(canPublishStaged({ active: "v1" }, { active: "v0" }, "v2")).toBe(false);
    expect(canPublishStaged({ active: "v1" }, { active: "v1", staged: "v3" }, "v2")).toBe(false);
  });
});

it("offers a required update only a staged build other than the document's", () => {
  expect(requiredUpdateCandidate("v1", { active: "v1", staged: "v2" })).toBe("v2");
  expect(requiredUpdateCandidate("v1", { staged: "v2" })).toBe("v2");
  expect(requiredUpdateCandidate("v1", { active: "v3", staged: "v2" })).toBeUndefined();
  expect(requiredUpdateCandidate("v1", { active: "v1", staged: "v1" })).toBeUndefined();
  expect(requiredUpdateCandidate("v1", { active: "v1" })).toBeUndefined();
});
