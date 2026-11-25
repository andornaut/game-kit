// The grouped install and staging steps over fake stores, downloads and pointers. launch.test.ts
// covers the same paths through createLaunch.
import { describe, expect, it, vi } from "vitest";

import {
  type BuildGroupReference,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
} from "../buildContract.ts";
import type { BuildGroupFile, BuildGroupStore } from "./buildGroupStore.ts";
import {
  type GroupedInstallContext,
  type GroupedStagingContext,
  installGrouped,
  type LaunchGroupsContext,
  prepareGroups,
  stageGroups,
  verifyGroupedManifest,
} from "./launchGroups.ts";

const POLICY = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
const STORED: BuildGroupReference = { byteSize: 4, schema: 1, sha256: "a".repeat(64) };
const PLAIN: BuildGroupReference = { byteSize: 10, schema: 1, sha256: "b".repeat(64) };
const GZIP: BuildGroupReference = {
  byteSize: 100,
  encodedByteSize: 30,
  encoding: "gzip",
  schema: 1,
  sha256: "c".repeat(64),
};
const POINTER: BuildPointer = {
  buildId: "id-bbbb",
  groups: [STORED, PLAIN, GZIP],
  manifest: buildManifestUrl("bbbb"),
  schema: 1,
  version: "bbbb",
};
const MANIFEST: BuildManifest = {
  boot: ["/a.js"],
  buildId: "id-bbbb",
  files: [
    { byteSize: 5, sha256: "d".repeat(64), url: "/a.js" },
    { byteSize: 6, sha256: "e".repeat(64), url: "/play/" },
  ],
  schema: 1,
  sounds: {},
  version: "bbbb",
};
const member = (byteSize: number): BuildGroupFile => ({
  blob: new Blob(["x".repeat(byteSize)]),
  byteSize,
  contentType: "text/plain",
  offset: 0,
});
const MEMBERS = new Map([
  ["/a.js", member(5)],
  ["/play/", member(6)],
]);

function fakeGroups() {
  const calls: string[] = [];
  let sealed = false;
  let deployed = POINTER;
  let members: ReadonlyMap<string, BuildGroupFile> = MEMBERS;
  let active: string | undefined;
  const groupStore: BuildGroupStore = {
    complete: vi.fn(async () => sealed),
    put: vi.fn(async (_pointer, group) => {
      calls.push(`put ${group.byteSize}`);
    }),
    read: vi.fn(async () => ({ files: members, kind: "ready" as const })),
    reuse: vi.fn(async (_pointer, group) => group === STORED),
    seal: vi.fn(async () => {
      calls.push("seal");
      sealed = true;
    }),
  };
  const downloadGroup = vi.fn<LaunchGroupsContext["downloadGroup"]>(async (group, onBytes) => {
    calls.push(`download ${group.byteSize}`);
    const transfer = group.encodedByteSize ?? group.byteSize;
    onBytes(transfer, transfer);
    return new Blob();
  });
  const context: LaunchGroupsContext = {
    downloadGroup,
    fetch: vi.fn(async () => new Response("")),
    groupRouterReady: vi.fn(async () => true),
    groupStore,
    policy: POLICY,
    readDeployedManifest: vi.fn(async () => MANIFEST),
    readPointer: vi.fn(async () => {
      calls.push("pointer");
      return deployed;
    }),
    signal: new AbortController().signal,
    soundFormat: undefined,
    store: {
      readState: async () => (active === undefined ? {} : { active }),
      setActive: vi.fn(async (version: string) => {
        calls.push(`active ${version}`);
        active = version;
      }),
    },
  };
  return {
    calls,
    context,
    downloadGroup,
    groupStore,
    redeploy: () => {
      deployed = { ...POINTER, buildId: "id-cccc", version: "cccc" };
    },
    seal: () => {
      sealed = true;
    },
    setActive: (version: string) => {
      active = version;
    },
    setMembers: (next: ReadonlyMap<string, BuildGroupFile>) => {
      members = next;
    },
  };
}

describe("prepareGroups", () => {
  it("downloads only unstored groups, counting transport bytes, then rereads the pointer and seals", async () => {
    const f = fakeGroups();
    const bytes: [number, number][] = [];
    await expect(
      prepareGroups(
        f.context,
        { foreground: false, onBytes: (received, total) => bytes.push([received, total]) },
        POINTER,
      ),
    ).resolves.toBe("complete");
    expect(f.calls).toEqual([
      "download 10",
      "put 10",
      "download 100",
      "put 100",
      "pointer",
      "seal",
    ]);
    expect(bytes).toEqual([
      [0, 40],
      [10, 40],
      [40, 40],
    ]);
  });

  it("returns changed without sealing when the pointer moved during the download", async () => {
    const f = fakeGroups();
    f.downloadGroup.mockImplementation(async () => {
      f.redeploy();
      return new Blob();
    });
    await expect(
      prepareGroups(f.context, { foreground: false, onBytes: () => undefined }, POINTER),
    ).resolves.toBe("changed");
    expect(f.groupStore.seal).not.toHaveBeenCalled();
  });

  it("skips a sealed build in the background but rereads the pointer in the foreground", async () => {
    const background = fakeGroups();
    background.seal();
    const onBytes = vi.fn();
    await expect(
      prepareGroups(background.context, { foreground: false, onBytes }, POINTER),
    ).resolves.toBe("complete");
    expect(background.calls).toEqual([]);
    expect(onBytes).not.toHaveBeenCalled();

    const foreground = fakeGroups();
    foreground.seal();
    foreground.redeploy();
    await expect(
      prepareGroups(foreground.context, { foreground: true, onBytes }, POINTER),
    ).resolves.toBe("changed");
    expect(foreground.calls).toEqual(["pointer"]);
    expect(foreground.groupStore.seal).not.toHaveBeenCalled();
  });

  it("treats a failed foreground fetch as a redeploy only when the pointer changed", async () => {
    const fetching: LaunchGroupsContext["downloadGroup"] = async (group, _onBytes, fetch) => {
      const response = await fetch!(`/group-${group.sha256}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return new Blob();
    };
    const redeployed = fakeGroups();
    redeployed.downloadGroup.mockImplementation(fetching);
    vi.mocked(redeployed.context.fetch).mockResolvedValue(new Response("", { status: 404 }));
    redeployed.redeploy();
    await expect(
      prepareGroups(redeployed.context, { foreground: true, onBytes: () => undefined }, POINTER),
    ).resolves.toBe("changed");
    expect(redeployed.calls).toEqual(["pointer"]);

    const unchanged = fakeGroups();
    unchanged.downloadGroup.mockImplementation(fetching);
    const error = new TypeError("Failed to fetch");
    vi.mocked(unchanged.context.fetch).mockRejectedValue(error);
    await expect(
      prepareGroups(unchanged.context, { foreground: true, onBytes: () => undefined }, POINTER),
    ).rejects.toBe(error);
    expect(unchanged.calls).toEqual(["pointer"]);

    const background = fakeGroups();
    background.downloadGroup.mockImplementation(async (_group, _onBytes, fetch) => {
      expect(fetch).toBeUndefined();
      throw new Error("HTTP 404");
    });
    background.redeploy();
    await expect(
      prepareGroups(background.context, { foreground: false, onBytes: () => undefined }, POINTER),
    ).rejects.toThrow("HTTP 404");
    expect(background.calls).toEqual([]);
  });

  it("refuses a page without grouped storage", async () => {
    const f = fakeGroups();
    await expect(
      prepareGroups(
        { ...f.context, groupStore: undefined },
        { foreground: true, onBytes: () => undefined },
        POINTER,
      ),
    ).rejects.toMatchObject({
      message: "Grouped build storage unavailable",
      reason: "verification",
    });
  });
});

describe("verifyGroupedManifest", () => {
  it("accepts stored members that match the manifest and names the first mismatch", async () => {
    const f = fakeGroups();
    await expect(verifyGroupedManifest(f.context, MANIFEST)).resolves.toBeUndefined();
    f.setMembers(new Map([["/a.js", member(5)]]));
    await expect(verifyGroupedManifest(f.context, MANIFEST)).rejects.toMatchObject({
      message: "Grouped build member is missing for /play/",
      reason: "verification",
    });
    vi.mocked(f.groupStore.read).mockResolvedValue({ kind: "unknown" });
    await expect(verifyGroupedManifest(f.context, MANIFEST)).rejects.toMatchObject({
      message: "Grouped build members do not match the manifest",
      reason: "verification",
    });
  });
});

function installContext(f: ReturnType<typeof fakeGroups>) {
  const progress: string[] = [];
  const context: GroupedInstallContext = {
    ...f.context,
    disposed: vi.fn(() => false),
    onBootBytes: (bootBytes) => progress.push(`boot ${bootBytes}`),
    onBytes: (received, total) => progress.push(`${received}/${total}`),
    onRecorded: (version) => progress.push(`recorded ${version}`),
    reload: vi.fn(),
    waitForRouter: vi.fn(async () => undefined),
  };
  return { context, progress };
}

describe("installGrouped", () => {
  it("activates the sealed build, records progress and reloads", async () => {
    const f = fakeGroups();
    const { context, progress } = installContext(f);
    await expect(installGrouped(context, POINTER)).resolves.toBe("reloading");
    expect(f.calls.slice(-2)).toEqual(["seal", "active bbbb"]);
    expect(progress).toEqual(["boot 5", "0/40", "10/40", "40/40", "recorded bbbb"]);
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it("reports zero bytes when every group is already stored", async () => {
    const f = fakeGroups();
    vi.mocked(f.groupStore.reuse).mockResolvedValue(true);
    const { context, progress } = installContext(f);
    await expect(installGrouped(context, POINTER)).resolves.toBe("reloading");
    expect(f.downloadGroup).not.toHaveBeenCalled();
    expect(progress).toEqual(["boot 5", "0/0", "recorded bbbb"]);
  });

  it("does not activate a build whose members do not match the manifest", async () => {
    const f = fakeGroups();
    f.setMembers(new Map([["/a.js", member(5)]]));
    const { context } = installContext(f);
    await expect(installGrouped(context, POINTER)).rejects.toMatchObject({
      message: "Grouped build member is missing for /play/",
      reason: "verification",
    });
    expect(f.context.store.setActive).not.toHaveBeenCalled();
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("keeps another context's active build and reloads without recording", async () => {
    const f = fakeGroups();
    f.setActive("aaaa");
    const { context, progress } = installContext(f);
    await expect(installGrouped(context, POINTER)).resolves.toBe("reloading");
    expect(f.context.store.setActive).not.toHaveBeenCalled();
    expect(progress).not.toContain("recorded bbbb");
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it("does not reload a disposed launch", async () => {
    const f = fakeGroups();
    const { context } = installContext(f);
    vi.mocked(context.disposed).mockReturnValue(true);
    await expect(installGrouped(context, POINTER)).resolves.toBe("reloading");
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("does not activate when the router stops serving groups before activation", async () => {
    const f = fakeGroups();
    const { context } = installContext(f);
    vi.mocked(context.groupRouterReady).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(installGrouped(context, POINTER)).rejects.toMatchObject({
      message: "Could not activate the sealed grouped build",
      reason: "verification",
    });
    expect(f.context.store.setActive).not.toHaveBeenCalled();
    expect(context.reload).not.toHaveBeenCalled();
  });
});

describe("stageGroups", () => {
  const stagingContext = (f: ReturnType<typeof fakeGroups>) => {
    const context: GroupedStagingContext = {
      ...f.context,
      publishStaged: vi.fn(async () => undefined),
      reportUpdate: vi.fn(),
    };
    return context;
  };

  it("reports staging progress and publishes the verified build from the previous state", async () => {
    const f = fakeGroups();
    const context = stagingContext(f);
    const previous = { active: "aaaa" };
    await expect(stageGroups(context, previous, POINTER)).resolves.toBe("complete");
    expect(vi.mocked(context.reportUpdate).mock.calls.map(([state]) => state)).toEqual([
      { phase: "staging", value: 0, version: "bbbb" },
      { phase: "staging", value: 0.25, version: "bbbb" },
      { phase: "staging", value: 1, version: "bbbb" },
    ]);
    expect(context.publishStaged).toHaveBeenCalledWith(previous, "bbbb", POINTER);
  });

  it("neither downloads nor publishes when the router cannot serve groups", async () => {
    const f = fakeGroups();
    const context = stagingContext(f);
    vi.mocked(context.groupRouterReady).mockResolvedValue(false);
    await expect(stageGroups(context, {}, POINTER)).rejects.toMatchObject({
      message: "The controlling worker cannot serve grouped builds",
      reason: "verification",
    });
    expect(f.downloadGroup).not.toHaveBeenCalled();
    expect(context.publishStaged).not.toHaveBeenCalled();
  });

  it("does not publish a build whose members do not match the manifest", async () => {
    const f = fakeGroups();
    const context = stagingContext(f);
    f.setMembers(new Map([["/a.js", member(5)]]));
    await expect(stageGroups(context, {}, POINTER)).rejects.toMatchObject({
      reason: "verification",
    });
    expect(context.publishStaged).not.toHaveBeenCalled();
  });
});
