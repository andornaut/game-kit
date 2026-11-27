import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILD_POINTER_URL,
  buildArchivePartUrl,
  type BuildFile,
  buildGroupUrl,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
  type BuildState,
  type LaunchFailure,
  type LaunchProgress,
  type NetworkPlayNotice,
  ObsoleteUpdateOfferError,
  type UpdateOffer,
  type UpdateState,
} from "../../buildContract.ts";
import { installedManifest } from "../../buildRecords.ts";
import {
  BUILD_ARCHIVE_ROUTER_PROBE,
  BUILD_GROUP_ROUTER_PROBE,
} from "../routing/buildArchiveRouter.ts";
import type { BuildArchiveStore } from "../storage/buildArchiveStore.ts";
import type { ActiveGroupFormat, BuildGroupStore } from "../storage/buildGroupStore.ts";
import type { BuildStore } from "../storage/buildStore.ts";
import type { BuildInstallOptions, installBuild } from "../transfer/buildInstaller.ts";
import {
  CONTROL_WAIT_MS,
  createLaunch,
  type FetchLike,
  type LaunchPage,
  registerRouter,
  type RequiredUpdateState,
  type SessionLike,
  UPDATE_CHECK_MS,
  UPDATE_RETRY_MAX_MS,
  UPDATE_RETRY_MS,
  type UpdateProgress,
} from "./launch.ts";

const POLICY = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
const ORIGIN = "https://game.test";
const ROUTER = "/sw.js";
const LAUNCH_PROGRESS_KEY = "game-kit:launch-progress";
const LAUNCH_RELOAD_KEY = "game-kit:launch-reload";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function buildOf(version: string, bodies: Record<string, string>, boot: string[] = []) {
  const files: BuildFile[] = Object.entries(bodies).map(([url, body]) => ({
    byteSize: new TextEncoder().encode(body).byteLength,
    sha256: sha(body),
    url,
  }));
  const manifest: BuildManifest = {
    boot,
    buildId: `id-${version}`,
    files,
    schema: 1,
    sounds: {},
    version,
  };
  const pointer: BuildPointer = {
    buildId: manifest.buildId,
    manifest: buildManifestUrl(version),
    schema: 1,
    version,
  };
  return { manifest, pointer };
}

class FakeStore implements BuildStore {
  state: { active?: string; staged?: string } = {};
  readonly manifests = new Map<string, BuildManifest>();
  readonly completeVersions = new Set<string>();
  readonly calls: string[] = [];

  async readState(): Promise<BuildState> {
    return { ...this.state };
  }
  async setActive(version: string) {
    this.calls.push(`setActive ${version}`);
    this.state.active = version;
  }
  async setStaged(version: string | undefined) {
    this.calls.push(`setStaged ${version}`);
    if (version === undefined) {
      delete this.state.staged;
    } else {
      this.state.staged = version;
    }
  }
  async readManifest(version: string) {
    return this.manifests.get(version);
  }
  async saveManifest(manifest: BuildManifest) {
    this.calls.push(`saveManifest ${manifest.version}`);
    this.manifests.set(manifest.version, manifest);
  }
  async missing(manifest: BuildManifest) {
    return [...manifest.files];
  }
  async complete(manifest: BuildManifest) {
    return this.completeVersions.has(manifest.version);
  }
  async reclaim(documentVersions: Iterable<string>) {
    this.calls.push(`reclaim ${[...documentVersions].join(",")}`);
    return [];
  }
  async pinnedVersions() {
    return new Map<string, string>();
  }
  async putFile() {}
  async findByHash() {
    return undefined;
  }
  async readPin() {
    return undefined;
  }
  async writePin() {}
  async deletePin() {}
}

class FakeSession implements SessionLike {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeContainer extends EventTarget {
  controller: LaunchPage["container"]["controller"] = null;
  readonly register = vi.fn(async () => ({}));

  claim(postMessage?: (message: string, ports: MessagePort[]) => void) {
    this.controller = {
      ...(postMessage === undefined ? {} : { postMessage }),
      scriptURL: `${ORIGIN}${ROUTER}`,
    };
    this.dispatchEvent(new Event("controllerchange"));
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  set(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function fixture({
  archiveStore,
  groupStore,
  onUpdateProgress,
  soundFormat,
  updateProgress,
}: {
  archiveStore?: BuildArchiveStore;
  groupStore?: BuildGroupStore;
  onUpdateProgress?: (value: UpdateProgress) => void;
  soundFormat?: string;
  updateProgress?: UpdateProgress[];
} = {}) {
  const container = new FakeContainer();
  const visibility = new FakeDocument();
  const window = new EventTarget();
  const session = new FakeSession();
  const reload = vi.fn();
  const routes = new Map<string, () => Response>();
  const fetch = vi.fn<FetchLike>(async (input) => {
    const route = routes.get(input);
    if (route === undefined) {
      throw new TypeError("Failed to fetch");
    }
    return route();
  });
  let now = 0;
  let online = true;
  const page: LaunchPage = {
    container,
    eventTarget: window,
    fetch,
    location: { href: `${ORIGIN}/play/`, reload },
    online: () => online,
    storage: { manager: undefined, session },
    timers: {
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => now,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
    },
    visibility,
  };
  const deploy = (build: ReturnType<typeof buildOf>) => {
    routes.set(BUILD_POINTER_URL, () => Response.json(build.pointer));
    routes.set(build.pointer.manifest, () => Response.json(build.manifest));
  };
  const store = new FakeStore();
  const installs: BuildInstallOptions[] = [];
  let results: (() => Promise<"complete" | "changed">)[] = [];
  const install = vi.fn<typeof installBuild>(async (_context, options) => {
    installs.push(options);
    const total = options.manifest.files.reduce((sum, file) => sum + file.byteSize, 0);
    options.onBytes?.(0, total);
    while (options.paused?.() === true) {
      // The installer polls paused() before each fetch.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    const next = results.shift();
    const result = next === undefined ? "complete" : await next();
    if (result === "complete") {
      options.onBytes?.(total, total);
      store.completeVersions.add(options.manifest.version);
    }
    return result;
  });
  const progress: LaunchProgress[] = [];
  const failures: LaunchFailure[] = [];
  const networkPlay: NetworkPlayNotice[] = [];
  const offers: UpdateOffer[] = [];
  const updates: UpdateState[] = [];
  const required: RequiredUpdateState[] = [];
  const launch = createLaunch(
    {
      ...(archiveStore === undefined ? {} : { archiveStore }),
      ...(groupStore === undefined ? {} : { groupStore }),
      installBuild: install,
      page,
      policy: POLICY,
      store,
    },
    {
      onFailure: (failure) => failures.push(failure),
      onNetworkPlay: (notice) => networkPlay.push(notice),
      onProgress: (value) => progress.push(value),
      onRequireNewer: (state) => required.push(state),
      ...(updateProgress === undefined && onUpdateProgress === undefined
        ? {}
        : {
            onUpdateProgress(value: UpdateProgress) {
              updateProgress?.push(value);
              onUpdateProgress?.(value);
            },
          }),
      onUpdateReady: (offer) => offers.push(offer),
      onUpdateState: (state) => updates.push(state),
      serviceWorkerUrl: ROUTER,
      soundFormat,
    },
  );
  return {
    advance: (ms: number) => {
      now += ms;
    },
    container,
    deploy,
    failures,
    fetch,
    installBuild: install,
    installs,
    launch,
    networkPlay,
    offers,
    progress,
    reload,
    required,
    routes,
    session,
    setOnline: (value: boolean) => {
      online = value;
      window.dispatchEvent(new Event(value ? "online" : "offline"));
    },
    setResults: (next: (() => Promise<"complete" | "changed">)[]) => {
      results = next;
    },
    store,
    updates,
    visibility,
    window,
  };
}

// Lets queued promise callbacks and store calls run, one macrotask turn at a time.
const settle = (turns = 20): Promise<void> =>
  turns === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        setImmediate(resolve);
      }).then(() => settle(turns - 1));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const V1 = buildOf("aaaa", { "/a.js": "alpha", "/play/": "<html>" }, ["/a.js"]);
const V2 = buildOf("bbbb", { "/a.js": "alpha2", "/play/": "<html>" }, ["/a.js"]);
const V3 = buildOf("cccc", { "/a.js": "alpha3", "/play/": "<html>" }, ["/a.js"]);
const SOUNDS = (() => {
  const { manifest, pointer } = buildOf("ssss", {
    "/a.js": "alpha",
    "/hit.m4a": "m4a bytes",
    "/hit.ogg": "ogg bytes",
    "/play/": "<html>",
  });
  return { manifest: { ...manifest, sounds: { "/hit": ["/hit.ogg", "/hit.m4a"] } }, pointer };
})();

const failedInstall = () =>
  Promise.reject(Object.assign(new Error("No progress"), { reason: "network" }));

afterEach(() => {
  vi.useRealTimers();
});

describe("whole-build updates", () => {
  const body = "verified archive";
  const archive = { byteSize: body.length, schema: 1, sha256: sha(body) } as const;
  const build = { ...V2, pointer: { ...V2.pointer, archive } };
  const archivePath = buildArchivePartUrl(archive, 0);

  it("stages only the archive, then waits for explicit consent to activate it", async () => {
    let stored = false;
    const put = vi.fn(async () => {
      stored = true;
    });
    const f = fixture({
      archiveStore: {
        complete: async () => stored,
        put,
        read: async () => ({ kind: "unknown" }),
      },
    });
    f.container.claim((message, [port]) => {
      if (message === BUILD_ARCHIVE_ROUTER_PROBE) {
        port?.postMessage(message);
      }
    });
    f.store.state.active = V1.pointer.version;
    f.deploy(build);
    f.routes.set(archivePath, () => new Response(body));
    f.visibility.set("hidden");
    await expect(f.launch.run()).resolves.toBe("play");
    await vi.waitFor(() =>
      expect(f.updates).toContainEqual({
        phase: "staging",
        value: 0,
        version: build.pointer.version,
      }),
    );
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    f.visibility.set("visible");
    await vi.waitFor(() => expect(f.offers).toHaveLength(1));
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      archivePath,
      BUILD_POINTER_URL,
    ]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: V1.pointer.version, staged: build.pointer.version });
    expect(f.reload).not.toHaveBeenCalled();
    const save = vi.fn();
    await f.offers[0]!.updateNow(save);
    expect(save).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: build.pointer.version });
    expect(f.reload).toHaveBeenCalledOnce();
    f.launch.dispose();
  });

  it("does not download or stage an archive under a legacy controlling router", async () => {
    const put = vi.fn();
    const f = fixture({
      archiveStore: {
        complete: async () => false,
        put,
        read: async () => ({ kind: "unknown" }),
      },
    });
    f.container.claim();
    f.store.state.active = V1.pointer.version;
    f.deploy(build);
    await f.launch.run();
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(put).not.toHaveBeenCalled();
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(f.offers).toEqual([]);
    expect(f.store.state).toEqual({ active: V1.pointer.version });
    f.launch.dispose();
  });
});

describe("grouped updates", () => {
  const body = "changed group";
  const changed = { byteSize: body.length, schema: 1, sha256: sha(body) } as const;
  const unchanged = { byteSize: 1, schema: 1, sha256: sha("a") } as const;
  const build = { ...V2, pointer: { ...V2.pointer, groups: [unchanged, changed] } };
  const changedPath = buildArchivePartUrl(changed, 0);
  const cold = { ...build, pointer: { ...build.pointer, groupedFirstInstall: true as const } };
  const coldFiles = (script = "alpha2") =>
    new Map([
      [
        "/a.js",
        {
          blob: new Blob([script]),
          byteSize: script.length,
          contentType: "text/javascript",
          offset: 0,
        },
      ],
      ["/play/", { blob: new Blob(["<html>"]), byteSize: 6, contentType: "text/html", offset: 0 }],
    ]);
  const readCold = async () => ({ files: coldFiles(), kind: "ready" as const });

  it("waits for the router and seals and activates groups before the first reload", async () => {
    let sealed = false;
    const put = vi.fn();
    const seal = vi.fn(async () => {
      sealed = true;
    });
    const f = fixture({
      groupStore: {
        complete: async () => sealed,
        put,
        read: readCold,
        reuse: async () => false,
        seal,
      },
    });
    f.deploy(cold);
    const unchangedPath = buildArchivePartUrl(unchanged, 0);
    f.routes.set(unchangedPath, () => new Response("a"));
    f.routes.set(changedPath, () => new Response(body));
    const started = f.launch.run();
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(f.store.state).toEqual({});
    const probe = vi.fn((message: string, [port]: MessagePort[]) => {
      port?.postMessage(message);
      port?.close();
    });
    f.container.claim(probe);
    await expect(started).resolves.toBe("reloading");
    expect(probe.mock.calls.map(([message]) => message)).toEqual([
      BUILD_GROUP_ROUTER_PROBE,
      BUILD_GROUP_ROUTER_PROBE,
    ]);
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      cold.pointer.manifest,
      unchangedPath,
      changedPath,
      BUILD_POINTER_URL,
    ]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(seal).toHaveBeenCalledExactlyOnceWith(cold.pointer, expect.any(AbortSignal));
    expect(f.store.calls).toEqual([`setActive ${cold.pointer.version}`]);
    expect(f.store.state).toEqual({ active: cold.pointer.version });
    expect(f.offers).toEqual([]);
    expect(f.updates).toEqual([]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.progress.at(-1)).toMatchObject({
      phase: "installing",
      receivedBytes: unchanged.byteSize + changed.byteSize,
      totalBytes: unchanged.byteSize + changed.byteSize + 6,
    });
    expect(f.progress.at(-1)!.value).toBeLessThan(1);
    f.launch.dispose();
  });

  it("installs compressed groups from their transport, counting wire bytes", async () => {
    const decoded = "compressible ".repeat(200);
    const encoded = new Uint8Array(gzipSync(decoded, { level: 9 }));
    const gzip = {
      byteSize: decoded.length,
      encodedByteSize: encoded.byteLength,
      encoding: "gzip",
      schema: 1,
      sha256: sha(decoded),
    } as const;
    const pointer = { ...cold.pointer, groups: [unchanged, gzip] };
    let sealed = false;
    const put = vi.fn();
    const f = fixture({
      groupStore: {
        complete: async () => sealed,
        put,
        read: readCold,
        reuse: async () => false,
        seal: async () => {
          sealed = true;
        },
      },
    });
    f.deploy({ ...cold, pointer });
    f.routes.set(buildArchivePartUrl(unchanged, 0), () => new Response("a"));
    f.routes.set(buildGroupUrl(gzip), () => new Response(encoded));
    f.container.claim((message, [port]) => port?.postMessage(message));
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      pointer.manifest,
      buildArchivePartUrl(unchanged, 0),
      `/.game-kit/group-${gzip.sha256}.bin`,
      BUILD_POINTER_URL,
    ]);
    // The store receives the verified decoded archive under the group's decoded identity.
    expect(put.mock.calls.map(([, group]) => group)).toEqual([unchanged, gzip]);
    expect(await (put.mock.calls[1]![2] as Blob).text()).toBe(decoded);
    const wire = unchanged.byteSize + encoded.byteLength;
    expect(f.progress.at(-1)).toMatchObject({ receivedBytes: wire, totalBytes: wire + 6 });
    expect(f.store.state).toEqual({ active: pointer.version });
    f.launch.dispose();
  });

  it("retries a partial grouped install without activation or repeating a verified group", async () => {
    let sealed = false;
    const stored = new Set<string>();
    const put = vi.fn((_pointer: BuildPointer, group: { sha256: string }) => {
      stored.add(group.sha256);
      return Promise.resolve();
    });
    const seal = vi.fn(async () => {
      sealed = true;
    });
    const f = fixture({
      groupStore: {
        complete: async () => sealed,
        put,
        read: readCold,
        reuse: async (_pointer, group) => stored.has(group.sha256),
        seal,
      },
    });
    f.deploy(cold);
    const unchangedPath = buildArchivePartUrl(unchanged, 0);
    f.routes.set(unchangedPath, () => new Response("a"));
    f.routes.set(changedPath, () => new Response("x".repeat(body.length)));
    f.container.claim((message, [port]) => {
      port?.postMessage(message);
      port?.close();
    });
    const started = f.launch.run();
    await vi.waitFor(() => expect(f.failures).toHaveLength(1));
    expect(put).toHaveBeenCalledOnce();
    expect(seal).not.toHaveBeenCalled();
    expect(f.store.calls).toEqual([]);
    expect(f.offers).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();
    f.routes.set(changedPath, () => new Response(body));
    f.failures[0]!.retry();
    await expect(started).resolves.toBe("reloading");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      cold.pointer.manifest,
      unchangedPath,
      changedPath,
      BUILD_POINTER_URL,
      cold.pointer.manifest,
      changedPath,
      BUILD_POINTER_URL,
    ]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(seal).toHaveBeenCalledOnce();
    expect(f.store.calls).toEqual([`setActive ${cold.pointer.version}`]);
    f.launch.dispose();
  });

  it("leaves a sealed first install inactive when the controller changes before publication", async () => {
    let sealed = false;
    const seal = vi.fn(async () => {
      sealed = true;
      f.container.claim();
    });
    const f = fixture({
      groupStore: {
        complete: async () => sealed,
        put: async () => {},
        read: readCold,
        reuse: async () => true,
        seal,
      },
    });
    f.deploy(cold);
    f.container.claim((message, [port]) => {
      port?.postMessage(message);
      port?.close();
    });
    void f.launch.run();
    await vi.waitFor(() => expect(f.failures).toHaveLength(1));
    expect(f.failures[0]?.reason).toBe("verification");
    expect(seal).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({});
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.networkPlay).toEqual([]);
    f.launch.dispose();
  });

  it("refuses a sealed grouped install with a missing manifest member", async () => {
    const files = coldFiles();
    files.delete("/a.js");
    const f = fixture({
      groupStore: {
        complete: async () => true,
        put: vi.fn(),
        read: async () => ({ files, kind: "ready" }),
        reuse: vi.fn(),
        seal: vi.fn(),
      },
    });
    f.deploy(cold);
    f.container.claim((message, [port]) => {
      port?.postMessage(message);
      port?.close();
    });
    void f.launch.run();
    await vi.waitFor(() => expect(f.failures).toHaveLength(1));
    expect(f.failures[0]?.reason).toBe("verification");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      cold.pointer.manifest,
      BUILD_POINTER_URL,
    ]);
    expect(f.store.calls).toEqual([]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(f.networkPlay).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();
    f.launch.dispose();
  });

  it.each(["sealed", "HTTP 404"])(
    "follows a changed deployment from a %s candidate",
    async (source) => {
      const successor = {
        ...V3,
        pointer: { ...V3.pointer, groupedFirstInstall: true as const, groups: [unchanged] },
      };
      const f = fixture({
        groupStore: {
          complete: async (version) => version === successor.pointer.version || source === "sealed",
          put: vi.fn(),
          read: async () => ({ files: coldFiles("alpha3"), kind: "ready" }),
          reuse: async () => false,
          seal: vi.fn(),
        },
      });
      f.deploy(cold);
      f.deploy(successor);
      let first = true;
      f.routes.set(BUILD_POINTER_URL, () => {
        const pointer = first ? cold.pointer : successor.pointer;
        first = false;
        return Response.json(pointer);
      });
      const removedPart = buildArchivePartUrl(unchanged, 0);
      f.routes.set(removedPart, () => new Response("removed", { status: 404 }));
      f.container.claim((message, [port]) => {
        port?.postMessage(message);
        port?.close();
      });
      await expect(f.launch.run()).resolves.toBe("reloading");
      expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
        BUILD_POINTER_URL,
        cold.pointer.manifest,
        ...(source === "HTTP 404" ? [removedPart] : []),
        BUILD_POINTER_URL,
        BUILD_POINTER_URL,
        successor.pointer.manifest,
        BUILD_POINTER_URL,
      ]);
      expect(f.store.calls).toEqual([`setActive ${successor.pointer.version}`]);
      expect(f.installBuild).not.toHaveBeenCalled();
      expect(f.reload).toHaveBeenCalledOnce();
      f.launch.dispose();
    },
  );

  it("reports the original archive HTTP failure when the pointer still names the same deployment", async () => {
    const f = fixture({
      groupStore: {
        complete: async () => false,
        put: vi.fn(),
        read: async () => ({ kind: "unknown" }),
        reuse: async () => false,
        seal: vi.fn(),
      },
    });
    f.deploy(cold);
    const missing = buildArchivePartUrl(unchanged, 0);
    f.routes.set(missing, () => new Response("missing", { status: 404 }));
    f.container.claim((message, [port]) => {
      port?.postMessage(message);
      port?.close();
    });
    void f.launch.run();
    await vi.waitFor(() => expect(f.failures).toHaveLength(1));
    expect(f.failures[0]?.reason).toBe("network");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      cold.pointer.manifest,
      missing,
      BUILD_POINTER_URL,
    ]);
    expect(f.store.calls).toEqual([]);
    expect(f.networkPlay).toEqual([]);
    f.launch.dispose();
  });

  it.each(["registration", "quota"])(
    "keeps an archive-first deployment fenced after %s failure",
    async (refusal) => {
      const f = fixture({
        groupStore: {
          complete: () => Promise.reject(Object.assign(new Error("full"), { reason: "quota" })),
          put: vi.fn(),
          read: async () => ({ kind: "unknown" }),
          reuse: vi.fn(),
          seal: vi.fn(),
        },
      });
      f.deploy(cold);
      if (refusal === "registration") {
        f.container.register.mockRejectedValue(new Error("denied"));
      } else {
        f.container.claim((message, [port]) => {
          port?.postMessage(message);
          port?.close();
        });
      }
      void f.launch.run();
      await vi.waitFor(() => expect(f.failures).toHaveLength(1));
      expect(f.failures[0]?.reason).toBe("verification");
      expect(f.fetch.mock.calls.map(([url]) => url)).toEqual(
        refusal === "registration"
          ? [BUILD_POINTER_URL]
          : [BUILD_POINTER_URL, cold.pointer.manifest],
      );
      expect(f.networkPlay).toEqual([]);
      expect(f.installBuild).not.toHaveBeenCalled();
      expect(f.store.calls).toEqual([]);
      f.launch.dispose();
    },
  );

  it("downloads just the missing group and seals the version before offering", async () => {
    let sealed = false;
    const put = vi.fn();
    const seal = vi.fn(async () => {
      sealed = true;
    });
    const f = fixture({
      groupStore: {
        complete: async () => sealed,
        put,
        read: async () => (sealed ? { files: coldFiles(), kind: "ready" } : { kind: "unknown" }),
        reuse: async (_pointer, group) => group.sha256 === unchanged.sha256,
        seal,
      },
    });
    f.container.claim((message, [port]) => {
      if (message === BUILD_GROUP_ROUTER_PROBE) {
        port?.postMessage(message);
      }
    });
    f.store.state.active = V1.pointer.version;
    f.deploy(build);
    f.routes.set(changedPath, () => new Response(body));
    await expect(f.launch.run()).resolves.toBe("play");
    await vi.waitFor(() => expect(f.offers).toHaveLength(1));
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      build.pointer.manifest,
      changedPath,
      BUILD_POINTER_URL,
    ]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledExactlyOnceWith(
      build.pointer,
      changed,
      expect.any(Blob),
      expect.any(AbortSignal),
    );
    expect(seal).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: V1.pointer.version, staged: build.pointer.version });
    const save = vi.fn();
    await f.offers[0]!.updateNow(save);
    expect(save).toHaveBeenCalledOnce();
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: build.pointer.version });
    f.launch.dispose();
  });

  it("reports a verification failure without staging when the current router cannot serve groups", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const complete = vi.fn(async () => false);
    const put = vi.fn();
    const reuse = vi.fn();
    const seal = vi.fn();
    const f = fixture({
      groupStore: {
        complete,
        put,
        read: async () => ({ kind: "unknown" }),
        reuse,
        seal,
      },
    });
    const probe = vi.fn((_message: string, [port]: MessagePort[]) => port?.close());
    f.container.claim(probe);
    f.store.state.active = V1.pointer.version;
    f.deploy(build);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(f.launch.run()).resolves.toBe("play");
      await settle();
      expect(probe).toHaveBeenCalledExactlyOnceWith(BUILD_GROUP_ROUTER_PROBE, [
        expect.any(MessagePort),
      ]);
      await vi.advanceTimersByTimeAsync(CONTROL_WAIT_MS);
      expect(warn).toHaveBeenCalledWith(
        "Background update failed.",
        expect.objectContaining({ reason: "verification" }),
      );
      expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
      expect(f.updates).toEqual([{ phase: "failed", version: build.pointer.version }]);
      expect(f.failures).toEqual([]);
      expect(f.offers).toEqual([]);
      expect(f.installBuild).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(reuse).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(seal).not.toHaveBeenCalled();
      expect(f.store.calls).toEqual([`reclaim ${V1.pointer.version}`]);
      expect(f.store.state).toEqual({ active: V1.pointer.version });
      expect(f.reload).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      f.launch.dispose();
    }
  });
});

describe("codec-aware groups", () => {
  const bodies: Record<string, string> = {
    "/a.js": "alpha",
    "/hit.m4a": "m4a body bytes",
    "/hit.ogg": "ogg",
    "/play/": "<html>",
  };
  const groupOf = (archive: string, members: string[], soundFormat?: string) => ({
    body: archive,
    members,
    reference: {
      byteSize: archive.length,
      schema: 1 as const,
      sha256: sha(archive),
      ...(soundFormat === undefined ? {} : { soundFormat }),
    },
  });
  const core = groupOf("core group", ["/a.js", "/play/"]);
  const ogg = groupOf("ogg group", ["/hit.ogg"], "ogg");
  const m4a = groupOf("m4a group bytes", ["/hit.m4a"], "m4a");
  // An earlier kit's group, holding both alternatives without a format.
  const mixed = groupOf("mixed sounds", ["/hit.m4a", "/hit.ogg"]);
  const deployment = (version: string, groups: ReturnType<typeof groupOf>[], cold: boolean) => {
    const { manifest, pointer } = buildOf(version, bodies, ["/hit.m4a"]);
    return {
      groups,
      manifest: { ...manifest, sounds: { "/hit": ["/hit.ogg", "/hit.m4a"] } },
      pointer: {
        ...pointer,
        ...(cold ? { groupedFirstInstall: true as const } : {}),
        groups: groups.map(({ reference }) => reference),
      },
    };
  };
  type Deployment = ReturnType<typeof deployment>;

  // A group store whose ready files are the members of the groups the pointer it sealed names.
  function groupStore(all: ReturnType<typeof groupOf>[], drop?: string) {
    const members = new Map(all.map(({ members, reference }) => [reference.sha256, members]));
    const stored = new Set<string>();
    let sealed: BuildPointer | undefined;
    const same = (pointer: BuildPointer) => JSON.stringify(pointer) === JSON.stringify(sealed);
    const readFiles = (pointer = sealed) => {
      if (pointer === undefined) {
        return { kind: "unknown" as const };
      }
      const urls = pointer.groups!.flatMap(({ sha256 }) => members.get(sha256)!);
      const files = new Map(
        urls
          .filter((url) => url !== drop)
          .map((url) => [
            url,
            {
              blob: new Blob([bodies[url]!]),
              byteSize: bodies[url]!.length,
              contentType: "application/octet-stream",
              offset: 0,
            },
          ]),
      );
      return { files, kind: "ready" as const };
    };
    const store = {
      complete: vi.fn(async (_version: string, expected?: BuildPointer) =>
        sealed === undefined ? false : expected === undefined || same(expected),
      ),
      put: vi.fn(async (_pointer: BuildPointer, group: { sha256: string }) => {
        stored.add(group.sha256);
      }),
      read: vi.fn(async () => readFiles()),
      reuse: vi.fn(async (_pointer: BuildPointer, group: { sha256: string }) =>
        stored.has(group.sha256),
      ),
      seal: vi.fn(async (pointer: BuildPointer) => {
        sealed = pointer;
      }),
    } satisfies BuildGroupStore;
    const activeFormat: ActiveGroupFormat = {
      differs: async (pointer) => sealed !== undefined && !same(pointer),
      seal: async (pointer, signal, verify) => {
        const read = readFiles(pointer);
        if (read.kind === "ready" && (await verify(read.files))) {
          signal.throwIfAborted();
          await store.seal(pointer);
        }
      },
    };
    return { store: { ...store, activeFormat }, stored };
  }

  function launchFor(build: Deployment, soundFormat: string | undefined, drop?: string) {
    const groups = groupStore(build.groups, drop);
    const f = fixture({
      groupStore: groups.store,
      ...(soundFormat === undefined ? {} : { soundFormat }),
    });
    f.deploy(build);
    for (const { body, reference } of build.groups) {
      f.routes.set(buildArchivePartUrl(reference, 0), () => new Response(body));
    }
    f.container.claim((message, [port]) => {
      port?.postMessage(message);
      port?.close();
    });
    return { ...f, groups };
  }

  const archivePaths = (...groups: ReturnType<typeof groupOf>[]) =>
    groups.map(({ reference }) => buildArchivePartUrl(reference, 0));

  it("installs only the device format's groups and sizes progress from the reduced manifest", async () => {
    const build = deployment("cdc1", [core, m4a, ogg], true);
    const f = launchFor(build, "ogg");
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      build.pointer.manifest,
      ...archivePaths(core, ogg),
      BUILD_POINTER_URL,
    ]);
    const installed = { ...build.pointer, groups: [core.reference, ogg.reference] };
    expect(f.groups.store.seal).toHaveBeenCalledExactlyOnceWith(installed, expect.any(AbortSignal));
    expect(f.groups.store.put.mock.calls.map(([pointer]) => pointer)).toEqual([
      installed,
      installed,
    ]);
    expect(f.store.state).toEqual({ active: build.pointer.version });
    // The boot file is the kept Ogg alternative of the manifest's M4A boot entry.
    expect(f.progress.at(-1)).toMatchObject({
      receivedBytes: core.reference.byteSize + ogg.reference.byteSize,
      totalBytes: core.reference.byteSize + ogg.reference.byteSize + bodies["/hit.ogg"]!.length,
    });
    f.launch.dispose();
  });

  async function activeForM4a(drop?: string) {
    const build = deployment("cdc7", [core, m4a, ogg], true);
    const f = launchFor(build, "m4a", drop);
    const before = { ...build.pointer, groups: [core.reference, ogg.reference] };
    const after = { ...build.pointer, groups: [core.reference, m4a.reference] };
    f.groups.stored.add(core.reference.sha256);
    f.groups.stored.add(ogg.reference.sha256);
    await f.groups.store.seal(before);
    f.store.state = { active: before.version };
    f.groups.store.seal.mockClear();
    return { ...f, after, before, build };
  }

  it("plays before discovery and repairs the selected audio from the regular check", async () => {
    const f = await activeForM4a();
    const discovery = deferred<Response>();
    f.fetch.mockImplementationOnce(() => discovery.promise);
    await expect(f.launch.run()).resolves.toBe("play");
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(await f.groups.store.complete(f.before.version, f.before)).toBe(true);

    discovery.resolve(Response.json(f.build.pointer));
    await settle();
    const paths = f.fetch.mock.calls.map(([path]) => path);
    expect(paths).toEqual([
      BUILD_POINTER_URL,
      f.build.pointer.manifest,
      ...archivePaths(m4a),
      BUILD_POINTER_URL,
    ]);
    expect(await f.groups.store.complete(f.before.version, f.after)).toBe(true);
    expect(f.offers).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();
    f.launch.dispose();
  });

  it("plays a soundless grouped build while the only version check is pending", async () => {
    const base = buildOf("cd90", { "/a.js": bodies["/a.js"]!, "/play/": bodies["/play/"]! });
    const build = {
      ...base,
      groups: [core],
      manifest: { ...base.manifest, sounds: {} },
      pointer: { ...base.pointer, groups: [core.reference] },
    };
    const f = launchFor(build, undefined);
    f.groups.stored.add(core.reference.sha256);
    await f.groups.store.seal(build.pointer);
    f.store.state = { active: build.pointer.version };
    const discovery = deferred<Response>();
    f.fetch.mockImplementationOnce(() => discovery.promise);
    await expect(f.launch.run()).resolves.toBe("play");
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    discovery.resolve(Response.json(build.pointer));
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(f.offers).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();
    f.launch.dispose();
  });

  it.each([
    "available",
    "offline",
    "unreachable",
    "old router",
    "missing member",
    "concurrent staging",
    "concurrent activation",
    "redeployed",
  ] as const)(
    "starts the installed grouped build with the new audio group %s",
    async (scenario) => {
      const f = await activeForM4a(scenario === "missing member" ? "/hit.m4a" : undefined);
      const [audio] = archivePaths(m4a);
      if (scenario === "offline") {
        f.setOnline(false);
      } else if (scenario === "unreachable") {
        f.routes.delete(audio!);
      } else if (scenario === "old router") {
        f.container.claim((_message, [port]) => {
          port?.postMessage(BUILD_GROUP_ROUTER_PROBE);
          port?.close();
        });
      } else if (scenario === "concurrent staging") {
        f.routes.set(audio!, () => {
          f.store.state = { active: f.before.version, staged: "cdc9" };
          return new Response(m4a.body);
        });
      } else if (scenario === "concurrent activation") {
        f.routes.set(audio!, () => {
          f.store.state = { active: "cdc8", staged: "cdc9" };
          return new Response(m4a.body);
        });
      } else if (scenario === "redeployed") {
        const successor = deployment("cdc8", [core, m4a, ogg], true);
        f.routes.set(audio!, () => {
          f.deploy(successor);
          return new Response(m4a.body);
        });
      }

      await expect(f.launch.run()).resolves.toBe("play");
      await settle();
      f.launch.dispose();
      expect(await f.groups.store.complete(f.before.version, f.after)).toBe(
        scenario === "available",
      );
      expect(await f.groups.store.complete(f.before.version, f.before)).toBe(
        scenario !== "available",
      );
      const transfers = f.fetch.mock.calls
        .map(([url]) => url)
        .filter((url) => url.includes("/.game-kit/archive-"));
      expect(transfers).toEqual(scenario === "offline" || scenario === "old router" ? [] : [audio]);
      if (scenario === "offline") {
        expect(f.fetch).not.toHaveBeenCalled();
      }
      const state = { active: f.before.version };
      if (scenario === "concurrent activation") {
        expect(f.store.state).toEqual({ active: "cdc8", staged: "cdc9" });
      } else if (scenario === "concurrent staging") {
        expect(f.store.state).toEqual({ ...state, staged: "cdc9" });
      } else {
        expect(f.store.state).toEqual(state);
      }
      expect(f.store.calls).toEqual([`reclaim ${f.before.version}`]);
      expect(f.reload).not.toHaveBeenCalled();
      expect([f.progress, f.failures, f.networkPlay, f.offers, f.updates]).toEqual([
        [],
        [],
        [],
        [],
        [],
      ]);
    },
  );

  it("installs every group without a sound format", async () => {
    const build = deployment("cdc2", [core, m4a, ogg], true);
    const f = launchFor(build, undefined);
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      build.pointer.manifest,
      ...archivePaths(core, m4a, ogg),
      BUILD_POINTER_URL,
    ]);
    expect(f.groups.store.seal).toHaveBeenCalledExactlyOnceWith(
      build.pointer,
      expect.any(AbortSignal),
    );
    expect(f.store.state).toEqual({ active: build.pointer.version });
    f.launch.dispose();
  });

  it.each([
    ["the device format's member is missing", [core, m4a, ogg], "ogg", "/hit.ogg", false],
    ["an untagged group also holds a left-out alternative", [core, mixed], "ogg", undefined, true],
    ["every member is required without a format", [core, m4a, ogg], undefined, "/hit.m4a", false],
  ] as const)(
    "verifies a grouped first install against the reduced manifest when %s",
    async (_case, groups, soundFormat, drop, activates) => {
      const build = deployment("cdc3", [...groups], true);
      const f = launchFor(build, soundFormat, drop);
      const started = f.launch.run();
      if (activates) {
        await expect(started).resolves.toBe("reloading");
        expect(f.store.state).toEqual({ active: build.pointer.version });
      } else {
        await vi.waitFor(() => expect(f.failures).toHaveLength(1));
        expect(f.failures[0]?.reason).toBe("verification");
        expect(f.store.calls).toEqual([]);
        expect(f.reload).not.toHaveBeenCalled();
      }
      f.launch.dispose();
    },
  );

  it("stages a grouped update from the device format's groups and verifies before offering", async () => {
    const build = deployment("cdc4", [core, m4a, ogg], false);
    const f = launchFor(build, "ogg");
    f.groups.stored.add(core.reference.sha256);
    f.store.state.active = V1.pointer.version;
    await expect(f.launch.run()).resolves.toBe("play");
    await vi.waitFor(() => expect(f.offers).toHaveLength(1));
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      build.pointer.manifest,
      ...archivePaths(ogg),
      BUILD_POINTER_URL,
    ]);
    expect(f.groups.store.seal).toHaveBeenCalledExactlyOnceWith(
      { ...build.pointer, groups: [core.reference, ogg.reference] },
      expect.any(AbortSignal),
    );
    expect(f.store.state).toEqual({ active: V1.pointer.version, staged: build.pointer.version });
    f.launch.dispose();
  });

  it("does not offer a grouped update missing a member of the device format", async () => {
    const build = deployment("cdc5", [core, m4a, ogg], false);
    const f = launchFor(build, "ogg", "/hit.ogg");
    f.store.state.active = V1.pointer.version;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(f.launch.run()).resolves.toBe("play");
      await vi.waitFor(() =>
        expect(f.updates).toContainEqual({ phase: "failed", version: build.pointer.version }),
      );
      expect(f.fetch.mock.calls.map(([url]) => url)).not.toContain(archivePaths(m4a)[0]);
      expect(f.offers).toEqual([]);
      expect(f.store.state).toEqual({ active: V1.pointer.version });
    } finally {
      warn.mockRestore();
      f.launch.dispose();
    }
  });
});

describe("first install", () => {
  it("registers the router, installs in the foreground and plays when the router controls the page", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.register.mockImplementation(async () => {
      f.container.claim();
      return {};
    });
    await expect(f.launch.run()).resolves.toBe("play");
    expect(f.container.register).toHaveBeenCalledWith(ROUTER, {
      scope: "/",
      updateViaCache: "none",
    });
    expect(f.fetch.mock.calls[0]).toEqual([BUILD_POINTER_URL, { cache: "no-store" }]);
    expect(f.fetch.mock.calls[1]?.[0]).toBe(V1.pointer.manifest);
    expect(f.installs[0]).toMatchObject({ lanes: 6, manifest: V1.manifest, priority: "auto" });
    expect(f.store.calls.slice(0, 2)).toEqual(["saveManifest aaaa", "setActive aaaa"]);
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("reports one determinate, nondecreasing value over download and boot bytes", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.register.mockImplementation(async () => {
      f.container.claim();
      return {};
    });
    await f.launch.run();
    f.launch.bootProgress(0, 2);
    f.launch.bootProgress(1, 2);
    f.launch.bootProgress(2, 2);
    const values = f.progress.map((p) => p.value);
    expect(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    const download = 5 + 6;
    const boot = 5;
    const installed = f.progress.filter((p) => p.phase === "installing").at(-1)!;
    // The record write adds the held-back 1% after the download share.
    expect(installed.value).toBeCloseTo(0.99 * (download / (download + boot)) + 0.01);
    expect(installed.totalBytes).toBe(download + boot);
    expect(f.progress.at(-1)).toEqual({
      phase: "ready",
      receivedBytes: download + boot,
      totalBytes: download + boot,
      value: 1,
    });
  });

  it("reloads once into the router when it does not yet control the page", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.deploy(V1);
    const result = f.launch.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CONTROL_WAIT_MS);
    await expect(result).resolves.toBe("reloading");
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.session.getItem(LAUNCH_PROGRESS_KEY)!)).toEqual({
      bootBytes: 5,
      receivedBytes: 11,
      version: "aaaa",
    });
  });

  it("reloads as soon as the router claims the page", async () => {
    const f = fixture();
    f.deploy(V1);
    const result = f.launch.run();
    await settle();
    f.container.claim();
    await expect(result).resolves.toBe("reloading");
    expect(f.reload).toHaveBeenCalledTimes(1);
  });

  it("restarts on the new manifest when the build changed, then reloads the old document into it", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.claim();
    f.setResults([
      async () => {
        f.deploy(V2);
        return "changed";
      },
    ]);
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.installs.map((o) => o.manifest.version)).toEqual(["aaaa", "bbbb"]);
    expect(f.store.state.active).toBe("bbbb");
    expect(f.store.calls).not.toContain("saveManifest aaaa");
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(f.session.getItem(LAUNCH_RELOAD_KEY)).toBe("bbbb");
    expect(JSON.parse(f.session.getItem(LAUNCH_PROGRESS_KEY)!)).toMatchObject({
      version: "bbbb",
    });
  });

  it("plays instead of reloading again when the document before it already reloaded into the build", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.claim();
    f.session.setItem(LAUNCH_RELOAD_KEY, "bbbb");
    f.setResults([
      async () => {
        f.deploy(V2);
        return "changed";
      },
    ]);
    await expect(f.launch.run()).resolves.toBe("play");
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.session.getItem(LAUNCH_RELOAD_KEY)).toBeNull();
  });

  it("reloads once onto the newer deployed build when a restarted install plays from the network", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.claim();
    f.setResults([
      async () => {
        f.deploy(V2);
        return "changed";
      },
      () => Promise.reject(Object.assign(new Error("full"), { reason: "quota" })),
    ]);
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(f.networkPlay).toEqual([]);
    expect(f.store.state.active).toBeUndefined();
  });

  it("reports a failure with a retry that resumes, and resolves once the retry succeeds", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.claim();
    f.setResults([
      () => Promise.reject(Object.assign(new Error("offline"), { reason: "network" })),
    ]);
    let result: string | undefined;
    void f.launch.run().then((value) => {
      result = value;
    });
    await settle();
    expect(f.failures.map((failure) => failure.reason)).toEqual(["network"]);
    expect(result).toBeUndefined();
    expect(f.store.state.active).toBeUndefined();
    const fetches = f.fetch.mock.calls.length;
    f.launch.requestUpdateCheck();
    await settle();
    expect(f.fetch).toHaveBeenCalledTimes(fetches);
    f.failures[0]!.retry();
    f.failures[0]!.retry();
    await settle();
    expect(result).toBe("play");
    expect(f.installs).toHaveLength(2);
  });

  it("fails with network when the pointer cannot be fetched", async () => {
    const f = fixture();
    void f.launch.run();
    await settle();
    expect(f.failures.map((failure) => failure.reason)).toEqual(["network"]);
    expect(f.networkPlay).toEqual([]);
    expect(f.installBuild).not.toHaveBeenCalled();
  });

  it("plays from the network with an unsupported notice when the router cannot register", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.register.mockRejectedValue(new Error("denied"));
    let noticesAtPlay: NetworkPlayNotice[] | undefined;
    await f.launch.run().then(() => {
      noticesAtPlay = [...f.networkPlay];
    });
    expect(noticesAtPlay).toEqual([{ reason: "unsupported" }]);
    await settle();
    expect(f.networkPlay).toEqual([{ reason: "unsupported" }]);
    expect(f.failures).toEqual([]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(f.store.state.active).toBeUndefined();
  });

  it("plays from the network with a quota notice when storage is full", async () => {
    const f = fixture();
    f.deploy(V1);
    f.container.claim();
    f.setResults([() => Promise.reject(Object.assign(new Error("full"), { reason: "quota" }))]);
    await expect(f.launch.run()).resolves.toBe("play");
    await settle();
    expect(f.networkPlay).toEqual([{ reason: "quota" }]);
    expect(f.failures).toEqual([]);
    expect(f.store.state.active).toBeUndefined();
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("installs only the sound format the page plays and saves that choice with the manifest", async () => {
    const f = fixture({ soundFormat: "ogg" });
    f.deploy(SOUNDS);
    f.container.claim();
    await expect(f.launch.run()).resolves.toBe("play");
    const installed = f.installs[0]!.manifest;
    expect(installed.files.map((file) => file.url)).toEqual(["/a.js", "/hit.ogg", "/play/"]);
    expect(installed.soundFormat).toBe("ogg");
    expect(f.store.manifests.get("ssss")).toEqual(installed);
  });

  it.each([
    ["the same sound format", "ogg", false],
    ["another sound format", "m4a", true],
    ["every alternative", undefined, true],
  ])("reuses a saved manifest only when saved for %s", async (_case, saved, fetched) => {
    const f = fixture({ soundFormat: "ogg" });
    f.deploy(SOUNDS);
    f.container.claim();
    f.store.manifests.set("ssss", installedManifest(saved, SOUNDS.manifest));
    await expect(f.launch.run()).resolves.toBe("play");
    expect(f.fetch.mock.calls.some(([url]) => url === SOUNDS.pointer.manifest)).toBe(fetched);
    expect(f.installs[0]!.manifest.files.map((file) => file.url)).not.toContain("/hit.m4a");
  });

  it("rejects a manifest that does not match the pointer", async () => {
    const f = fixture();
    f.deploy(V1);
    f.routes.set(V1.pointer.manifest, () => Response.json({ ...V1.manifest, version: "other" }));
    void f.launch.run();
    await settle();
    expect(f.failures.map((failure) => failure.reason)).toEqual(["verification"]);
    expect(f.networkPlay).toEqual([]);
  });
});

async function playing(f: ReturnType<typeof fixture>) {
  f.store.state = { active: "aaaa" };
  f.store.manifests.set("aaaa", V1.manifest);
  f.store.completeVersions.add("aaaa");
  f.container.claim();
  await expect(f.launch.run()).resolves.toBe("play");
  await settle();
}

describe("launch with an active build", () => {
  it("starts one pointer read before reclaim finishes and plays without waiting for it", async () => {
    const f = fixture();
    f.deploy(V1);
    f.store.state = { active: "aaaa" };
    const reclaim = f.store.reclaim.bind(f.store);
    let finishReclaim!: () => void;
    vi.spyOn(f.store, "reclaim").mockImplementationOnce(async (versions) => {
      await new Promise<void>((resolve) => {
        finishReclaim = resolve;
      });
      return reclaim(versions);
    });
    f.launch.requestUpdateCheck();
    expect(f.fetch).not.toHaveBeenCalled();
    const result = f.launch.run();
    await expect(result).resolves.toBe("play");
    f.launch.requestUpdateCheck();
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(f.installBuild).not.toHaveBeenCalled();
    finishReclaim();
    await settle();
    expect(f.store.calls[0]).toBe("reclaim aaaa");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    expect(f.installBuild).not.toHaveBeenCalled();
    expect(f.offers).toEqual([]);
  });

  it("bounds a pending startup pointer read without holding play and keeps the ordinary retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V1);
    f.fetch.mockImplementationOnce(() => new Promise(() => {}));
    await playing(f);
    const signal = f.fetch.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    vi.advanceTimersByTime(CONTROL_WAIT_MS);
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(f.fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(UPDATE_RETRY_MS);
    await settle();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.failures).toEqual([]);
    f.launch.dispose();
  });

  it.each(["hidden", "offline", "disposed"] as const)(
    "invalidates an early observation when the page becomes %s",
    async (state) => {
      const f = fixture();
      f.deploy(V2);
      let finish!: (response: Response) => void;
      f.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await playing(f);
      const signal = f.fetch.mock.calls[0]?.[1]?.signal;
      if (state === "hidden") {
        f.visibility.set("hidden");
      } else if (state === "offline") {
        f.setOnline(false);
      } else {
        f.launch.dispose();
      }
      finish(Response.json(V2.pointer));
      await settle();
      expect(signal?.aborted).toBe(true);
      expect(f.fetch).toHaveBeenCalledOnce();
      expect(f.offers).toEqual([]);
      if (state === "hidden") {
        f.visibility.set("visible");
      } else if (state === "offline") {
        f.setOnline(true);
      }
      await settle();
      expect(f.offers.map(({ version }) => version)).toEqual(
        state === "disposed" ? [] : [V2.pointer.version],
      );
      f.launch.dispose();
    },
  );

  it("confirms a prefetched running pointer before clearing an existing newer stage", async () => {
    const f = fixture();
    f.deploy(V1);
    f.store.state = { active: V1.pointer.version, staged: V2.pointer.version };
    let finishReclaim!: () => void;
    vi.spyOn(f.store, "reclaim").mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishReclaim = resolve;
      });
      return [];
    });
    await expect(f.launch.run()).resolves.toBe("play");
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([BUILD_POINTER_URL]);
    f.deploy(V2);
    finishReclaim();
    await settle();
    expect(f.store.calls).not.toContain("setStaged undefined");
    expect(f.store.state).toEqual({ active: V1.pointer.version, staged: V2.pointer.version });
    expect(f.offers.map(({ version }) => version)).toEqual([V2.pointer.version]);
    f.launch.dispose();
  });

  it("reloads once when this document is older than a complete staged build", async () => {
    const f = fixture();
    f.store.state = { active: "aaaa", staged: "bbbb" };
    f.store.manifests.set("bbbb", V2.manifest);
    f.store.completeVersions.add("bbbb");
    await expect(f.launch.run()).resolves.toBe("reloading");
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(f.session.getItem(LAUNCH_RELOAD_KEY)).toBe("bbbb");
    expect(f.store.calls).not.toContain("setActive bbbb");

    const again = fixture();
    again.session.setItem(LAUNCH_RELOAD_KEY, "bbbb");
    again.store.state = { active: "aaaa", staged: "bbbb" };
    again.store.manifests.set("bbbb", V2.manifest);
    again.store.completeVersions.add("bbbb");
    await expect(again.launch.run()).resolves.toBe("play");
    expect(again.reload).not.toHaveBeenCalled();
  });

  it("retries failed staged-build startup verification before writing the reload marker", async () => {
    const f = fixture();
    f.store.state = { active: "aaaa", staged: "bbbb" };
    f.store.manifests.set("bbbb", V2.manifest);
    f.store.completeVersions.add("bbbb");
    vi.spyOn(f.store, "complete").mockRejectedValueOnce(new Error("cache read refused"));
    const launched = f.launch.run().catch((error: unknown) => error);
    await settle();
    expect(f.failures.map((failure) => failure.reason)).toEqual(["verification"]);
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.session.getItem(LAUNCH_RELOAD_KEY)).toBeNull();
    expect(f.container.register).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    f.failures[0]!.retry();
    await expect(launched).resolves.toBe("reloading");
    expect(f.session.getItem(LAUNCH_RELOAD_KEY)).toBe("bbbb");
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
  });

  it("continues first-install progress carried across the reload", async () => {
    const f = fixture();
    f.session.setItem(
      LAUNCH_PROGRESS_KEY,
      JSON.stringify({ bootBytes: 10, receivedBytes: 90, version: "aaaa" }),
    );
    f.store.state = { active: "aaaa" };
    await f.launch.run();
    expect(f.progress).toHaveLength(1);
    expect(f.progress[0]).toMatchObject({ phase: "booting", receivedBytes: 90, totalBytes: 100 });
    expect(f.progress[0]!.value).toBeCloseTo(0.99 * 0.9 + 0.01);
    f.launch.bootProgress(1, 2);
    expect(f.progress.at(-1)).toMatchObject({
      phase: "booting",
      receivedBytes: 95,
      totalBytes: 100,
    });
    expect(f.progress.at(-1)!.value).toBeCloseTo(0.99 * 0.95 + 0.01);
    f.launch.bootProgress(2, 2);
    expect(f.progress.at(-1)).toMatchObject({ phase: "ready", value: 1 });
    expect(f.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();
  });
});

describe("background updates", () => {
  it("coalesces a caller-requested wake with focus, reconnect and resume and leaves activation explicit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.deploy(V2);
    const pointerFetches = () => f.fetch.mock.calls.filter(([url]) => url === BUILD_POINTER_URL);
    f.advance(10_000);
    vi.advanceTimersByTime(10_000);
    f.launch.requestUpdateCheck();
    f.launch.requestUpdateCheck();
    expect(vi.getTimerCount()).toBe(1);
    expect(pointerFetches()).toHaveLength(1);

    f.window.dispatchEvent(new Event("focus"));
    f.setOnline(false);
    f.setOnline(true);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    f.window.dispatchEvent(new Event("focus"));
    expect(vi.getTimerCount()).toBe(1);
    f.advance(49_999);
    vi.advanceTimersByTime(49_999);
    await settle();
    expect(pointerFetches()).toHaveLength(1);
    expect(f.offers).toEqual([]);
    f.advance(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(pointerFetches()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
    expect(f.reload).not.toHaveBeenCalled();

    const save = vi.fn(() => {
      expect(f.store.state.active).toBe("aaaa");
    });
    await f.offers[0]!.updateNow(save);
    expect(save).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: "bbbb" });
    expect(f.reload).toHaveBeenCalledOnce();
    expect(pointerFetches()).toHaveLength(2);
  });

  it.each(["hidden", "offline", "required", "disposed"] as const)(
    "ignores a caller-requested wake while %s",
    async (state) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const f = fixture();
      f.deploy(V1);
      await playing(f);
      switch (state) {
        case "hidden":
          f.visibility.set("hidden");
          break;
        case "offline":
          f.setOnline(false);
          break;
        case "required":
          f.launch.requireNewer();
          await settle();
          expect(f.required).toEqual(["updating", "unavailable"]);
          break;
        case "disposed":
          f.launch.dispose();
          break;
      }
      const fetches = f.fetch.mock.calls.length;
      f.deploy(V2);
      f.advance(UPDATE_CHECK_MS);
      vi.advanceTimersByTime(UPDATE_CHECK_MS);
      f.launch.requestUpdateCheck();
      await settle();
      expect(vi.getTimerCount()).toBe(0);
      expect(f.fetch).toHaveBeenCalledTimes(fetches);
      expect(f.store.state).toEqual({ active: "aaaa" });
      expect(f.offers).toEqual([]);
    },
  );

  it("stages a newer build in the background and offers it once", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    expect(f.installs[0]).toMatchObject({ lanes: 2, manifest: V2.manifest, priority: "low" });
    expect(f.store.calls).toContain("saveManifest bbbb");
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
    expect(f.updates.map((u) => u.phase)).toEqual(["staging", "staging", "ready"]);
    expect(f.offers.map((o) => o.version)).toEqual(["bbbb"]);
    expect(f.failures).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();

    f.offers[0]!.dismiss();
    f.advance(UPDATE_CHECK_MS);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(f.offers).toHaveLength(1);
    expect(f.store.state.active).toBe("aaaa");

    f.deploy(V3);
    f.advance(UPDATE_CHECK_MS);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(f.offers.map((o) => o.version)).toEqual(["bbbb", "cccc"]);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "cccc" });
  });

  it("checks on resume at most once per UPDATE_CHECK_MS", async () => {
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    const pointerFetches = () => f.fetch.mock.calls.filter(([url]) => url === BUILD_POINTER_URL);
    expect(pointerFetches()).toHaveLength(1);
    f.advance(UPDATE_CHECK_MS - 1);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(pointerFetches()).toHaveLength(1);
    f.advance(1);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(pointerFetches()).toHaveLength(2);
  });

  it("discovers on focus when an installed page stays visible", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.deploy(V2);
    f.window.dispatchEvent(new Event("blur"));
    f.advance(80_029);
    vi.advanceTimersByTime(80_029);
    expect(f.visibility.visibilityState).toBe("visible");
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.offers).toEqual([]);

    f.window.dispatchEvent(new Event("focus"));
    await settle();
    expect(f.visibility.visibilityState).toBe("visible");
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      BUILD_POINTER_URL,
      V2.pointer.manifest,
    ]);
    expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
    expect(f.reload).not.toHaveBeenCalled();
  });

  it.each(["resume", "reconnect", "focus"] as const)(
    "coalesces repeated %s events into one check at the cooldown boundary",
    async (event) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const f = fixture();
      f.deploy(V1);
      await playing(f);
      f.deploy(V2);
      const pointerFetches = () => f.fetch.mock.calls.filter(([url]) => url === BUILD_POINTER_URL);
      const wake = () => {
        if (event === "resume") {
          f.visibility.set("hidden");
          f.visibility.set("visible");
        } else if (event === "reconnect") {
          f.setOnline(false);
          f.setOnline(true);
        } else {
          f.window.dispatchEvent(new Event("focus"));
        }
      };
      f.advance(10_000);
      vi.advanceTimersByTime(10_000);
      wake();
      wake();
      f.advance(49_999);
      vi.advanceTimersByTime(49_999);
      await settle();
      expect(pointerFetches()).toHaveLength(1);
      expect(f.offers).toEqual([]);
      f.advance(1);
      vi.advanceTimersByTime(1);
      await settle();
      expect(pointerFetches()).toHaveLength(2);
      expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
      expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
      f.advance(2 * UPDATE_CHECK_MS);
      vi.advanceTimersByTime(2 * UPDATE_CHECK_MS);
      await settle();
      expect(pointerFetches()).toHaveLength(2);
    },
  );

  it("discovers on reconnect after an ordinary installed boot offline", async () => {
    const f = fixture();
    f.deploy(V2);
    f.setOnline(false);
    await playing(f);
    expect(f.fetch).not.toHaveBeenCalled();
    f.setOnline(true);
    await settle();
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      BUILD_POINTER_URL,
      V2.pointer.manifest,
    ]);
    expect(f.required).toEqual([]);
    expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
  });

  it.each(["hidden", "offline"] as const)(
    "recovers a deferred check after going %s",
    async (cause) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const f = fixture();
      f.deploy(V1);
      await playing(f);
      f.deploy(V2);
      f.visibility.set("hidden");
      f.visibility.set("visible");
      expect(vi.getTimerCount()).toBe(1);
      if (cause === "hidden") {
        f.visibility.set("hidden");
        f.setOnline(false);
        f.setOnline(true);
      } else {
        f.setOnline(false);
      }
      expect(vi.getTimerCount()).toBe(0);
      f.advance(UPDATE_CHECK_MS);
      vi.advanceTimersByTime(UPDATE_CHECK_MS);
      await settle();
      expect(f.fetch).toHaveBeenCalledTimes(1);
      if (cause === "hidden") {
        f.visibility.set("visible");
      } else {
        f.setOnline(true);
      }
      await settle();
      expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
      expect(f.fetch.mock.calls.filter(([url]) => url === BUILD_POINTER_URL)).toHaveLength(2);
    },
  );

  it("does not queue another check while staging is in flight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V2);
    let finish!: (result: "complete") => void;
    f.setResults([
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ]);
    await playing(f);
    f.advance(UPDATE_CHECK_MS);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    f.launch.requestUpdateCheck();
    f.visibility.set("hidden");
    f.visibility.set("visible");
    f.setOnline(false);
    f.setOnline(true);
    expect(vi.getTimerCount()).toBe(0);
    finish("complete");
    await settle();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    await settle();
    // Discovery reads once, then revalidates the prefetched pointer before publishing.
    expect(f.fetch.mock.calls.filter(([url]) => url === BUILD_POINTER_URL)).toHaveLength(2);
    expect(f.offers).toHaveLength(1);
  });

  it("pauses staging while hidden", async () => {
    const f = fixture();
    f.deploy(V2);
    f.visibility.set("hidden");
    await playing(f);
    expect(f.installs).toHaveLength(1);
    expect(f.store.state.staged).toBeUndefined();
    f.visibility.set("visible");
    await settle();
    expect(f.store.state.staged).toBe("bbbb");
  });

  it("reports a failed update through onUpdateState only, and retries at the next check", async () => {
    const f = fixture();
    f.deploy(V2);
    f.setResults([
      () => Promise.reject(Object.assign(new Error("offline"), { reason: "network" })),
    ]);
    await playing(f);
    expect(f.updates.at(-1)).toEqual({ phase: "failed", version: "bbbb" });
    expect(f.failures).toEqual([]);
    expect(f.offers).toEqual([]);
    f.advance(UPDATE_CHECK_MS);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(f.offers.map((o) => o.version)).toEqual(["bbbb"]);
  });

  it("bypasses a missing manifest's HTTP cache entry on the scheduled retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V2);
    const url = V2.pointer.manifest;
    const cacheModes = () =>
      f.fetch.mock.calls.filter(([path]) => path === url).map(([, init]) => init?.cache);
    f.routes.set(url, () => new Response(null, { status: 404 }));
    await playing(f);
    expect(cacheModes()).toEqual(["default"]);
    expect(f.updates.at(-1)).toEqual({ phase: "failed", version: "bbbb" });
    expect(f.store.state).toEqual({ active: "aaaa" });
    expect(f.offers).toEqual([]);

    f.deploy(V2);
    vi.advanceTimersByTime(UPDATE_RETRY_MS - 1);
    await settle();
    expect(cacheModes()).toEqual(["default"]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(cacheModes()).toEqual(["default", "reload"]);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
    expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb"]);
    expect(f.failures).toEqual([]);
    expect(f.reload).not.toHaveBeenCalled();
    f.launch.dispose();
  });

  it("retries a failed update while visible, from UPDATE_RETRY_MS doubling to UPDATE_RETRY_MAX_MS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V2);
    f.setResults(Array.from({ length: 6 }, () => failedInstall));
    await playing(f);
    expect(f.installs).toHaveLength(1);
    f.setOnline(false);
    f.setOnline(true);
    f.launch.requestUpdateCheck();
    expect(vi.getTimerCount()).toBe(1);
    const waits = [UPDATE_RETRY_MS, 120_000, 240_000, 480_000, UPDATE_RETRY_MAX_MS];
    for (const [index, wait] of [...waits, UPDATE_RETRY_MAX_MS].entries()) {
      vi.advanceTimersByTime(wait - 1);
      // Each step waits for the retry before it.
      // eslint-disable-next-line no-await-in-loop
      await settle();
      expect(f.installs).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      // eslint-disable-next-line no-await-in-loop
      await settle();
      expect(f.installs).toHaveLength(index + 2);
    }
    expect(f.offers.map((o) => o.version)).toEqual(["bbbb"]);
    expect(f.updates.filter((u) => u.phase === "failed")).toHaveLength(6);
    expect(f.failures).toEqual([]);
    vi.advanceTimersByTime(UPDATE_RETRY_MAX_MS * 2);
    await settle();
    expect(f.installs).toHaveLength(7);
  });

  it("cancels the update retry while hidden and on dispose, and re-arms it when visible", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V2);
    f.setResults([failedInstall, failedInstall]);
    await playing(f);
    f.visibility.set("hidden");
    vi.advanceTimersByTime(UPDATE_RETRY_MAX_MS);
    await settle();
    expect(f.installs).toHaveLength(1);
    // The resume falls within UPDATE_CHECK_MS of the last check, so only the retry runs.
    f.visibility.set("visible");
    await settle();
    expect(f.installs).toHaveLength(1);
    vi.advanceTimersByTime(UPDATE_RETRY_MS);
    await settle();
    expect(f.installs).toHaveLength(2);
    f.launch.dispose();
    vi.advanceTimersByTime(UPDATE_RETRY_MAX_MS);
    await settle();
    expect(f.installs).toHaveLength(2);
    expect(f.failures).toEqual([]);
  });

  it("Update now awaits the save, then activates the staged build and reloads with no download", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const fetches = f.fetch.mock.calls.length;
    f.setOnline(false);
    f.setOnline(true);
    let saved!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const switching = f.offers[0]!.updateNow(save);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.store.state.active).toBe("aaaa");
    expect(f.reload).not.toHaveBeenCalled();
    saved();
    await switching;
    expect(f.store.calls.slice(-2)).toEqual(["setActive bbbb", "setStaged undefined"]);
    expect(f.store.state).toEqual({ active: "bbbb" });
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.fetch.mock.calls.length).toBe(fetches);
  });

  it("carries an explicit Apply into matching boot once and leaves legacy boot reports intact", async () => {
    const updateProgress: UpdateProgress[] = [];
    const f = fixture({ updateProgress });
    f.deploy(V2);
    await playing(f);
    expect(updateProgress.map(({ phase }) => phase)).toEqual([
      "preparing",
      "transferring",
      "transferring",
      "verifying",
      "ready",
    ]);

    await f.offers[0]!.updateNow(() => {
      expect(updateProgress.at(-1)).toEqual({ phase: "applying", step: "save", version: "bbbb" });
    });
    expect(updateProgress.slice(-4)).toEqual(
      ["save", "verify", "activate", "reload"].map((step) => ({
        phase: "applying",
        step,
        version: "bbbb",
      })),
    );
    expect(f.reload).toHaveBeenCalledOnce();

    const resumed: UpdateProgress[] = [];
    const again = fixture({ updateProgress: resumed });
    const record = f.session.getItem(LAUNCH_PROGRESS_KEY)!;
    again.session.setItem(LAUNCH_PROGRESS_KEY, record);
    again.store.state = { active: "bbbb" };
    again.setOnline(false);
    await expect(again.launch.run()).resolves.toBe("play");
    expect(again.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();
    again.launch.bootProgress(1, 2);
    again.launch.bootProgress(2, 2);
    expect(resumed).toEqual([
      { phase: "booting", version: "bbbb" },
      { counts: { done: 1, total: 2 }, phase: "booting", version: "bbbb" },
      { phase: "applied", version: "bbbb" },
    ]);
    expect(again.progress.map(({ phase }) => phase)).toEqual(["booting", "ready"]);
    expect(again.reload).not.toHaveBeenCalled();

    const stale: UpdateProgress[] = [];
    const other = fixture({ updateProgress: stale });
    other.session.setItem(LAUNCH_PROGRESS_KEY, record);
    other.store.state = { active: "aaaa" };
    other.setOnline(false);
    await expect(other.launch.run()).resolves.toBe("play");
    other.launch.bootProgress(1, 1);
    expect(stale).toEqual([{ phase: "applyFailed", version: "bbbb" }]);
    expect(other.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();
  });

  it("does not reload or leave an Apply marker when a progress callback disposes the launch", async () => {
    const f = fixture({
      onUpdateProgress(state) {
        if (state.phase === "applying" && state.step === "reload") {
          f.launch.dispose();
        }
      },
    });
    f.deploy(V2);
    await playing(f);
    await f.offers[0]!.updateNow(() => undefined);
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();
  });

  it("falls back to ordinary boot when the Apply marker cannot be written or consumed", async () => {
    const updateProgress: UpdateProgress[] = [];
    const f = fixture({ updateProgress });
    f.deploy(V2);
    await playing(f);
    vi.spyOn(f.session, "setItem").mockImplementation(() => {
      throw new Error("storage refused");
    });
    await f.offers[0]!.updateNow(() => undefined);
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();

    const resumed: UpdateProgress[] = [];
    const again = fixture({ updateProgress: resumed });
    again.session.setItem(LAUNCH_PROGRESS_KEY, JSON.stringify({ updateVersion: "bbbb" }));
    vi.spyOn(again.session, "removeItem").mockImplementation(() => {
      throw new Error("storage refused");
    });
    again.store.state = { active: "bbbb" };
    again.setOnline(false);
    await expect(again.launch.run()).resolves.toBe("play");
    again.launch.bootProgress(1, 1);
    expect(again.progress.map(({ phase }) => phase)).toEqual(["ready"]);
    expect(resumed).toEqual([]);
  });

  it("reports a rejected Apply as failed and leaves no handoff", async () => {
    const updateProgress: UpdateProgress[] = [];
    const f = fixture({ updateProgress });
    f.deploy(V2);
    await playing(f);
    await expect(
      f.offers[0]!.updateNow(() => Promise.reject(new Error("save refused"))),
    ).rejects.toThrow("save refused");
    expect(updateProgress.slice(-2)).toEqual([
      { phase: "applying", step: "save", version: "bbbb" },
      { phase: "applyFailed", version: "bbbb" },
    ]);
    expect(f.session.getItem(LAUNCH_PROGRESS_KEY)).toBeNull();
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("Update now does not switch when the save fails", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const error = new Error("save failed");
    await expect(f.offers[0]!.updateNow(() => Promise.reject(error))).rejects.toBe(error);
    expect(f.store.state.active).toBe("aaaa");
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("keeps a still-current offer retryable when verification or activation fails", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const offer = f.offers[0]!;
    const save = () => undefined;
    f.store.completeVersions.delete("bbbb");
    const unverified = await offer.updateNow(save).catch((error: unknown) => error);
    expect(unverified).toBeInstanceOf(Error);
    expect(unverified).not.toBeInstanceOf(ObsoleteUpdateOfferError);

    f.store.completeVersions.add("bbbb");
    const failure = new Error("active record write failed");
    vi.spyOn(f.store, "setActive").mockRejectedValueOnce(failure);
    await expect(offer.updateNow(save)).rejects.toBe(failure);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "bbbb" });
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.offers).toHaveLength(1);

    await offer.updateNow(save);
    expect(f.store.state).toEqual({ active: "bbbb" });
    expect(f.reload).toHaveBeenCalledOnce();
  });

  it("keeps a disposed launch rejection distinct from an obsolete offer", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const saving = deferred<void>();
    const switching = f.offers[0]!.updateNow(() => saving.promise);
    f.launch.dispose();
    f.store.state.staged = "cccc";
    saving.resolve();
    const failure = await switching.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ObsoleteUpdateOfferError);
    expect(f.store.state).toEqual({ active: "aaaa", staged: "cccc" });
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("names the superseded offer when its successor shares the pending switch", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const saving = deferred<void>();
    const obsolete = f.offers[0]!;
    const switching = obsolete.updateNow(() => saving.promise);
    f.deploy(V3);
    f.advance(UPDATE_CHECK_MS);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    await settle();
    expect(f.offers.map((offer) => offer.version)).toEqual(["bbbb", "cccc"]);
    expect(f.store.completeVersions.has("bbbb")).toBe(true);
    const successor = f.offers[1]!;
    const saveSuccessor = vi.fn();
    const sharedSwitch = successor.updateNow(saveSuccessor);
    expect(sharedSwitch).toBe(switching);
    saving.resolve();
    const failure = await sharedSwitch.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ObsoleteUpdateOfferError);
    expect(failure).toHaveProperty("version", obsolete.version);
    expect(failure).not.toHaveProperty("version", successor.version);
    expect(saveSuccessor).not.toHaveBeenCalled();
    expect(f.store.state).toEqual({ active: "aaaa", staged: "cccc" });
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.offers).toHaveLength(2);
    await successor.updateNow(saveSuccessor);
    expect(saveSuccessor).toHaveBeenCalledOnce();
    expect(f.store.state).toEqual({ active: "cccc" });
    expect(f.reload).toHaveBeenCalledOnce();
  });

  it("reloads an offer already promoted during save and keeps another staged build", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const saving = deferred<void>();
    const switching = f.offers[0]!.updateNow(() => saving.promise);
    f.store.state = { active: "bbbb", staged: "cccc" };
    const writes = f.store.calls.length;
    saving.resolve();
    await switching;
    expect(f.store.calls).toHaveLength(writes);
    expect(f.store.state).toEqual({ active: "bbbb", staged: "cccc" });
    expect(f.reload).toHaveBeenCalledOnce();
  });

  it("keeps a newer active build when an older offer is still staged after verification", async () => {
    const f = fixture();
    f.deploy(V2);
    await playing(f);
    const verifying = deferred<boolean>();
    const complete = vi.spyOn(f.store, "complete").mockReturnValueOnce(verifying.promise);
    const switching = f.offers[0]!.updateNow(() => undefined);
    const failure = switching.catch((error: unknown) => error);
    await settle();
    expect(complete).toHaveBeenCalledWith(V2.manifest);
    f.store.state.active = "cccc";
    verifying.resolve(true);
    expect(await failure).toBeInstanceOf(ObsoleteUpdateOfferError);
    expect(f.store.state).toEqual({ active: "cccc", staged: "bbbb" });
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("does not replace a candidate staged while an older download is in flight", async () => {
    const f = fixture();
    f.deploy(V2);
    const downloading = deferred<"complete">();
    f.setResults([() => downloading.promise]);
    await playing(f);
    expect(f.installs).toHaveLength(1);
    f.store.state.staged = "cccc";
    downloading.resolve("complete");
    await settle();
    expect(f.store.state).toEqual({ active: "aaaa", staged: "cccc" });
    expect(f.offers).toEqual([]);
  });
});

describe("requireNewer", () => {
  it("reloads into an active build that changed while a staged build was being verified", async () => {
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.store.state.staged = "bbbb";
    f.store.manifests.set("bbbb", V2.manifest);
    const verifying = deferred<boolean>();
    const complete = vi.spyOn(f.store, "complete").mockReturnValueOnce(verifying.promise);
    f.launch.requireNewer();
    await settle();
    expect(complete).toHaveBeenCalledWith(V2.manifest);
    f.store.state = { active: "cccc", staged: "dddd" };
    verifying.resolve(true);
    await settle();
    expect(f.store.state).toEqual({ active: "cccc", staged: "dddd" });
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.offers).toEqual([]);
  });

  it("activates a complete staged build and reloads without an offer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.visibility.set("hidden");
    f.visibility.set("visible");
    f.store.state.staged = "bbbb";
    f.store.manifests.set("bbbb", V2.manifest);
    f.store.completeVersions.add("bbbb");
    f.launch.requireNewer();
    await settle();
    expect(f.required).toEqual(["updating"]);
    expect(f.store.state).toEqual({ active: "bbbb" });
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(f.offers).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("stages a newer build and switches to it, never offering it", async () => {
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.deploy(V2);
    f.launch.requireNewer();
    await settle();
    expect(f.installs.at(-1)).toMatchObject({ lanes: 6, manifest: V2.manifest });
    expect(f.required).toEqual(["updating"]);
    expect(f.store.state).toEqual({ active: "bbbb" });
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(f.offers).toEqual([]);
  });

  it("reports unavailable with nothing newer, and retries when the device reconnects", async () => {
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.setOnline(false);
    f.launch.requireNewer();
    await settle();
    expect(f.required).toEqual(["unavailable"]);
    f.deploy(V2);
    f.setOnline(true);
    await settle();
    expect(f.required).toEqual(["unavailable", "updating"]);
    expect(f.installs.at(-1)).toMatchObject({ lanes: 6, manifest: V2.manifest });
    expect(f.store.state.active).toBe("bbbb");
    expect(f.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads into a newer build another window already activated", async () => {
    const f = fixture();
    f.deploy(V1);
    await playing(f);
    f.store.state.active = "bbbb";
    f.launch.requireNewer();
    await settle();
    expect(f.required).toEqual(["updating"]);
    expect(f.reload).toHaveBeenCalledTimes(1);
  });
});

it("dispose removes the focus listener and cancels its deferred discovery check", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  f.deploy(V1);
  await playing(f);
  expect(getEventListeners(f.window, "focus")).toHaveLength(1);
  f.window.dispatchEvent(new Event("focus"));
  expect(vi.getTimerCount()).toBe(1);
  f.launch.dispose();
  expect(getEventListeners(f.window, "focus")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  f.setOnline(false);
  f.setOnline(true);
  f.advance(UPDATE_CHECK_MS);
  vi.advanceTimersByTime(UPDATE_CHECK_MS);
  f.window.dispatchEvent(new Event("focus"));
  await settle();
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it("dispose stops checks and listeners", async () => {
  const f = fixture();
  f.deploy(V1);
  await playing(f);
  f.launch.dispose();
  const fetches = f.fetch.mock.calls.length;
  f.advance(UPDATE_CHECK_MS);
  f.visibility.set("hidden");
  f.visibility.set("visible");
  await settle();
  expect(f.fetch.mock.calls.length).toBe(fetches);
});

describe("registerRouter", () => {
  it("registers the router for scope / past the HTTP cache, without fetching or installing", async () => {
    const container = new FakeContainer();
    await expect(registerRouter(container, ROUTER)).resolves.toBe(true);
    expect(container.register).toHaveBeenCalledExactlyOnceWith(ROUTER, {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("resolves false where the browser has no service workers or registration fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(registerRouter(undefined, ROUTER)).resolves.toBe(false);
    const container = new FakeContainer();
    container.register.mockRejectedValue(new Error("denied"));
    await expect(registerRouter(container, ROUTER)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
