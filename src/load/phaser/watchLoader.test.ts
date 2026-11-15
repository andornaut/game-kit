import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Loader, type Scene, Scenes, type Types } from "phaser";
import { describe, expect, it, vi } from "vitest";

import type { Timer } from "../../clock/timer.ts";
import { createProgressState, type ProgressSnapshot } from "../../progressState.ts";
import { LOADER_CONFIG, RETRY_ROUNDS_MS } from "../loaderConfig.ts";
import { type LoadFailure, watchLoader } from "./watchLoader.ts";

vi.mock("phaser", async () => {
  const nodeModule = await import("node:module");
  const path = await import("node:path");
  const load = nodeModule.createRequire(import.meta.url);
  const root = path.dirname(load.resolve("phaser/package.json"));
  // The real event names, so the fake loader below fires what Phaser's LoaderPlugin fires.
  return {
    Loader: { Events: load(path.join(root, "src/loader/events/index.js")) },
    Scenes: { Events: load(path.join(root, "src/scene/events/index.js")) },
  };
});

// Phaser's own MultiFile, which links the files of a multi-file load the way Phaser's loader
// methods do.
const phaserRequire = createRequire(import.meta.url);
const phaserRoot = dirname(phaserRequire.resolve("phaser/package.json"));
type MultiFileClass = new (loader: object, type: string, key: string, files: FakeFile[]) => object;
const MultiFile = phaserRequire(join(phaserRoot, "src/loader/MultiFile.js")) as MultiFileClass;

type XMLFileClass = new (
  loader: object,
  key: string,
  url: string,
  xhrSettings?: Types.Loader.XHRSettingsObject,
) => FakeFile;
const XMLFile = phaserRequire(join(phaserRoot, "src/loader/filetypes/XMLFile.js")) as XMLFileClass;

interface FontConfig {
  fontDataURL: string;
  key: string;
  textureURL: string;
}

interface FakeFile {
  config: unknown;
  key: string;
  linkFile: FakeFile | null;
  multiFile: object | null;
  retryAttempts: number;
  type: string;
  url: string;
  xhrSettings: Partial<Types.Loader.XHRSettingsObject>;
}

// Phaser's LoaderPlugin as the watch sees it: an emitter of Phaser's loader events with its
// queue, totals, base URL, path, prefix and XHR settings, and a bitmap font and an Aseprite sheet
// method that queue multi-file loads. start, settle and complete play a run.
class FakeLoader extends EventEmitter {
  baseURL = "";
  readonly cacheManager = { xml: {} };
  readonly list = new Set<FakeFile>();
  loading = false;
  maxRetries: number = LOADER_CONFIG.maxRetries;
  multiKeyIndex = 0;
  path = "";
  prefix = "";
  starts = 0;
  totalComplete = 0;
  totalFailed = 0;
  totalToLoad = 0;
  readonly xhr = { timeout: LOADER_CONFIG.timeout };

  create(type: string, key: string, url: string, config?: unknown, timeout = 0): FakeFile {
    return {
      config,
      key: this.prefix + key,
      linkFile: null,
      multiFile: null,
      retryAttempts: this.maxRetries,
      type,
      url: this.path + url,
      xhrSettings: { timeout },
    };
  }
  queue(file: FakeFile) {
    this.list.add(file);
    this.emit(Loader.Events.ADD, file.key, file.type, this, file);
    if (this.loading) {
      this.totalToLoad += 1;
    }
  }
  add(type: string, key: string, url: string, config?: unknown, timeout = 0): FakeFile {
    const file = this.create(type, key, url, config, timeout);
    this.queue(file);
    return file;
  }
  // Links one file per [type, url] part in a MultiFile, then queues them.
  multi(type: string, key: string, parts: readonly (readonly [string, string])[]) {
    const files = parts.map(([fileType, url]) => this.create(fileType, key, url));
    new MultiFile(this, type, key, files);
    for (const file of files) {
      this.queue(file);
    }
  }
  bitmapFont(key: string | FontConfig | readonly FontConfig[], textureURL = "", fontDataURL = "") {
    const configs = typeof key === "string" ? [{ fontDataURL, key, textureURL }] : [key].flat();
    for (const config of configs) {
      this.multi("bitmapfont", config.key, [
        ["image", config.textureURL],
        ["xml", config.fontDataURL],
      ]);
    }
    return this;
  }
  aseprite(key: string, textureURL: string, atlasURL: string) {
    this.multi("atlasjson", key, [
      ["image", textureURL],
      ["json", atlasURL],
    ]);
    return this;
  }
  image(key: string, url: string) {
    this.add("image", key, url);
  }
  json(key: string, url: string, dataKey?: string) {
    this.add("json", key, url, dataKey);
  }
  spritesheet(key: string, url: string, frameConfig: unknown) {
    this.add("spritesheet", key, url, frameConfig);
  }
  svg(key: string, url: string, svgConfig: unknown) {
    this.add("svg", key, url, svgConfig);
  }
  xml(key: string, url: string, xhrSettings?: Types.Loader.XHRSettingsObject) {
    this.queue(new XMLFile(this, key, url, xhrSettings));
    return this;
  }
  isLoading() {
    return this.loading;
  }
  start() {
    this.starts += 1;
    if (this.loading) {
      return;
    }
    this.totalComplete = 0;
    this.totalFailed = 0;
    this.totalToLoad = this.list.size;
    this.emit(Loader.Events.START, this);
    if (this.list.size === 0) {
      this.complete();
    } else {
      this.loading = true;
    }
  }
  // A file's last attempt ends: loaded, or failed with retriesLeft of its retries unused.
  settle(file: FakeFile, loaded: boolean, retriesLeft = 0) {
    this.list.delete(file);
    if (loaded) {
      this.totalComplete += 1;
      this.emit(Loader.Events.FILE_LOAD, file);
    } else {
      this.totalFailed += 1;
      Object.assign(file, { retryAttempts: retriesLeft });
      this.emit(Loader.Events.FILE_LOAD_ERROR, file);
    }
  }
  complete() {
    this.loading = false;
    this.list.clear();
    this.emit(Loader.Events.COMPLETE, this, this.totalComplete, this.totalFailed);
  }
  // Settles every queued file as loaded, or the files whose key or URL failing names as failed,
  // then completes.
  finish(failing: readonly string[] = []) {
    for (const file of [...this.list]) {
      this.settle(file, !(failing.includes(file.key) || failing.includes(file.url)));
    }
    this.complete();
  }
  keys() {
    return [...this.list].map((file) => file.key);
  }
  queued() {
    return [...this.list].map(({ key, type, url }) => [type, key, url]);
  }
}

// A timer whose pending handlers run only when the test fires them.
function fakeTimer() {
  const pending = new Map<number, { handler: () => void; ms: number }>();
  let next = 0;
  const timer: Timer = {
    clearTimeout: (handle) => pending.delete(handle as number),
    setTimeout: (handler, ms) => {
      next += 1;
      pending.set(next, { handler, ms });
      return next;
    },
  };
  return {
    fire() {
      const entries = [...pending.values()];
      pending.clear();
      for (const { handler } of entries) {
        handler();
      }
    },
    pending: () => [...pending.values()].map(({ ms }) => ms),
    timer,
  };
}

function setup(retryMode?: (failure: LoadFailure) => "automatic" | "manual") {
  const loader = new FakeLoader();
  const events = new EventEmitter();
  const scene = { events, load: loader } as unknown as Pick<Scene, "events" | "load">;
  const clock = fakeTimer();
  const warn = vi.fn<(message: string) => void>();
  const progress = createProgressState();
  const seen: ProgressSnapshot[] = [];
  progress.subscribe((snapshot) => seen.push(snapshot));
  const begin = vi.spyOn(progress, "begin");
  const watch = watchLoader<"boot" | "level">(
    {
      console: { warn },
      progress,
      ...(retryMode === undefined ? {} : { retryMode }),
      timer: clock.timer,
    },
    scene,
  );
  const values = () => seen.filter(({ active }) => active).map(({ value }) => value);
  return { begin, clock, events, loader, seen, values, warn, watch };
}

describe("LOADER_CONFIG", () => {
  it("is Phaser's loader config: a 30 s timeout and two retries", () => {
    const config: Types.Core.LoaderConfig = LOADER_CONFIG;
    expect(config).toEqual({ maxRetries: 2, timeout: 30_000 });
  });
});

describe("watchLoader", () => {
  it("retries native XML with its captured context while optional rounds continue", async () => {
    const classify = vi.fn((failure: LoadFailure) =>
      failure.key === "font.required" ? ("manual" as const) : ("automatic" as const),
    );
    const { clock, loader, watch } = setup(classify);
    loader.baseURL = "https://original.invalid/";
    loader.path = "fonts/";
    loader.prefix = "font.";
    const settings: Types.Loader.XHRSettingsObject = {
      headers: { "X-Fixture": "original" },
      overrideMimeType: "text/xml",
      responseType: "text",
      timeout: 4321,
      withCredentials: true,
    };
    loader.xml("required", "required.xml", settings);
    loader.xml("optional", "optional.xml");
    loader.xml("success", "success.xml");
    const original = [...loader.list][0]!;
    expect(original).toBeInstanceOf(XMLFile);
    const captured = { ...original.xhrSettings, headers: { "X-Fixture": "original" } };
    loader.start();
    loader.finish(["font.required", "font.optional"]);
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "font.required",
        rounds: 0,
        type: "xml",
        url: "fonts/required.xml",
      }),
    );
    expect(clock.pending()).toEqual([RETRY_ROUNDS_MS[0]]);
    loader.baseURL = "https://later.invalid/";
    loader.path = "later/";
    loader.prefix = "later.";
    Object.assign(original.xhrSettings.headers!, { "X-Fixture": "changed" });
    Object.assign(original.xhrSettings, { timeout: 999 });
    const xml = vi.spyOn(loader, "xml");
    const bases: string[] = [];
    loader.on(Loader.Events.ADD, () => bases.push(loader.baseURL));
    const retry = watch.retryFailures(({ key }) => key === "font.required");
    expect(xml).toHaveBeenLastCalledWith("font.required", "fonts/required.xml", captured);
    expect(bases).toEqual(["https://original.invalid/"]);
    expect(loader.queued()).toEqual([["xml", "font.required", "fonts/required.xml"]]);
    expect([...loader.list][0]?.xhrSettings).toEqual(captured);
    expect([loader.baseURL, loader.path, loader.prefix]).toEqual([
      "https://later.invalid/",
      "later/",
      "later.",
    ]);
    const retried = [...loader.list][0] as unknown as Loader.File;
    const open = vi.fn();
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open = open;
        overrideMimeType = vi.fn();
        send = vi.fn();
        setRequestHeader = vi.fn();
      },
    );
    try {
      retried.load();
      retried.load();
      expect(open.mock.calls.map((args) => args[1])).toEqual([
        "https://original.invalid/fonts/required.xml",
        "https://original.invalid/fonts/required.xml",
      ]);
      expect(loader.baseURL).toBe("https://later.invalid/");
    } finally {
      vi.unstubAllGlobals();
    }
    loader.finish(["font.required"]);
    expect(Object.hasOwn(retried, "load")).toBe(false);
    await retry;
    expect(watch.failures().find(({ key }) => key === "font.required")?.rounds).toBe(0);
    clock.fire();
    expect(loader.keys()).toEqual(["font.optional"]);
    expect(bases).toEqual(["https://original.invalid/", "https://original.invalid/"]);
    loader.finish(["font.optional"]);
    expect(watch.failures().find(({ key }) => key === "font.optional")?.rounds).toBe(1);
    expect(clock.pending()).toEqual([RETRY_ROUNDS_MS[1]]);
    const success = watch.retryFailures(({ key }) => key === "font.required");
    loader.finish();
    await success;
    expect(watch.failures().map(({ key }) => key)).toEqual(["font.optional"]);
    clock.fire();
    const disposedFile = [...loader.list][0] as unknown as Loader.File;
    expect(Object.hasOwn(disposedFile, "load")).toBe(true);
    expect(xml.mock.calls.some(([key]) => key === "font.success")).toBe(false);
    watch.dispose();
    expect(Object.hasOwn(disposedFile, "load")).toBe(false);
    expect(clock.pending()).toEqual([]);
    await watch.retryFailures(() => true);
    expect(loader.keys()).toEqual(["font.optional"]);
  });

  it("restores context and retains native XML capture after a queue error", async () => {
    const { loader, watch } = setup(() => "manual");
    loader.baseURL = "https://original.invalid/";
    loader.path = "fonts/";
    loader.prefix = "font.";
    loader.xml("required", "required.xml");
    loader.start();
    loader.finish(["font.required"]);
    loader.baseURL = "https://later.invalid/";
    loader.path = "later/";
    loader.prefix = "later.";
    const queue = vi.spyOn(loader, "xml").mockImplementation(() => {
      throw new Error("xml queue");
    });
    await expect(watch.retryFailures(() => true)).rejects.toThrow("xml queue");
    expect([loader.baseURL, loader.path, loader.prefix]).toEqual([
      "https://later.invalid/",
      "later/",
      "later.",
    ]);
    expect(watch.failures()).toHaveLength(1);
    queue.mockRestore();
    const retry = watch.retryFailures(() => true);
    expect(loader.queued()).toEqual([["xml", "font.required", "fonts/required.xml"]]);
    expect([...loader.list][0]?.xhrSettings.timeout).toBe(LOADER_CONFIG.timeout);
    loader.finish();
    await retry;
    expect(watch.failures()).toEqual([]);
  });

  it("keeps required failures manual while optional retries retain their independent round budget", async () => {
    const { clock, loader, watch } = setup((failure) =>
      failure.key === "required" ? "manual" : "automatic",
    );
    loader.add("json", "required", "required.json");
    loader.add("json", "optional", "optional.json");
    loader.add("image", "success", "success.png");
    loader.start();
    loader.finish(["required", "optional"]);
    for (const [index, delay] of RETRY_ROUNDS_MS.entries()) {
      expect(clock.pending()).toEqual([delay]);
      const retry = watch.retryFailures((failure) => failure.key === "required");
      expect(loader.keys()).toEqual(["required"]);
      loader.finish(["required"]);
      // Each explicit retry settles before exercising the still-pending automatic round.
      // eslint-disable-next-line no-await-in-loop
      await retry;
      expect(clock.pending()).toEqual([delay]);
      clock.fire();
      expect(loader.keys()).toEqual(["optional"]);
      loader.finish(["optional"]);
      expect(watch.failures().find(({ key }) => key === "required")?.rounds).toBe(0);
      expect(watch.failures().find(({ key }) => key === "optional")?.rounds).toBe(
        index + 1 < RETRY_ROUNDS_MS.length ? index + 1 : undefined,
      );
    }
    const retry = watch.retryFailures(() => true);
    loader.finish(["required"]);
    await retry;
    expect(watch.failures().map(({ key, rounds }) => [key, rounds])).toEqual([["required", 0]]);
    expect(clock.pending()).toEqual([]);
    const success = watch.retryFailures(() => true);
    loader.finish();
    await success;
    expect(watch.failures()).toEqual([]);
    expect(loader.keys()).not.toContain("success");
  });

  it("selects atomically, coalesces ADD reentry and unions requests through COMPLETE", async () => {
    const { loader, watch } = setup(() => "manual");
    loader.add("json", "a", "a.json");
    loader.add("json", "b", "b.json");
    loader.start();
    loader.finish(["a", "b"]);
    const failures = watch.failures();
    await expect(
      watch.retryFailures((failure) => {
        if (failure.key === "b") {
          throw new Error("predicate");
        }
        return true;
      }),
    ).rejects.toThrow("predicate");
    expect(loader.keys()).toEqual([]);
    expect(watch.failures()).toEqual(failures);
    let settled = false;
    let reentered: Promise<void> | undefined;
    loader.once(Loader.Events.ADD, () => {
      reentered = watch.retryFailures(() => true);
    });
    const first = watch.retryFailures(({ key }) => key === "a");
    expect(reentered).toBe(first);
    void first.then(() => {
      settled = true;
    });
    const second = watch.retryFailures(() => true);
    expect(second).toBe(first);
    expect(watch.retryFailures(() => true)).toBe(first);
    expect(loader.keys()).toEqual(["a", "b"]);
    await Promise.resolve();
    expect(settled).toBe(false);
    const a = [...loader.list].find(({ key }) => key === "a")!;
    loader.settle(a, false);
    // A failed logical load may not be queued twice in the same retry flight.
    expect(watch.retryFailures(() => true)).toBe(first);
    expect(loader.keys()).toEqual(["b"]);
    loader.finish();
    await first;
    expect(settled).toBe(true);
    expect(watch.failures().map(({ key, rounds }) => [key, rounds])).toEqual([["a", 0]]);
  });

  it("classifies and explicitly retries whole real MultiFile loads using captured args and context", async () => {
    const seen: LoadFailure[] = [];
    const { clock, loader, watch } = setup((failure) => {
      seen.push(failure);
      return "manual";
    });
    loader.baseURL = "https://assets.invalid/";
    loader.path = "art/";
    loader.prefix = "ui.";
    loader.bitmapFont("pixel", "pixel.png", "pixel.xml");
    loader.start();
    loader.finish(["ui.pixel"]);
    expect(
      seen.every(
        ({ config, key, type, url }) =>
          type === "bitmapFont" &&
          key === "ui.pixel" &&
          JSON.stringify(config) === JSON.stringify(["pixel", "pixel.png", "pixel.xml"]) &&
          url === "art/pixel.png",
      ),
    ).toBe(true);
    expect(watch.failures()).toHaveLength(1);
    expect(clock.pending()).toEqual([]);
    loader.baseURL = "https://other.invalid/";
    loader.path = "other/";
    loader.prefix = "other.";
    const original = loader.bitmapFont;
    const retry = watch.retryFailures(() => true);
    expect(loader.queued()).toEqual([
      ["image", "ui.pixel", "art/pixel.png"],
      ["xml", "ui.pixel", "art/pixel.xml"],
    ]);
    expect(new Set([...loader.list].map(({ multiFile }) => multiFile)).size).toBe(1);
    expect([...loader.list][0]?.multiFile).toMatchObject({
      baseURL: "https://assets.invalid/",
      path: "art/",
      prefix: "ui.",
    });
    expect([loader.baseURL, loader.path, loader.prefix]).toEqual([
      "https://other.invalid/",
      "other/",
      "other.",
    ]);
    expect(loader.bitmapFont).toBe(original);
    loader.finish(["art/pixel.xml"]);
    await retry;
    expect(watch.failures()[0]).toMatchObject({
      config: ["pixel", "pixel.png", "pixel.xml"],
      key: "ui.pixel",
      rounds: 0,
      type: "bitmapFont",
      url: "art/pixel.xml",
    });
  });

  it("fails classifier exceptions closed and rechecks dynamic classification at automatic fire", async () => {
    let mode: "automatic" | "manual" | "throw" = "throw";
    const { clock, loader, watch } = setup(() => {
      if (mode === "throw") {
        throw new Error("classification");
      }
      return mode;
    });
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish(["a"]);
    expect(watch.failures()).toHaveLength(1);
    expect(clock.pending()).toEqual([]);
    mode = "automatic";
    const retry = watch.retryFailures(() => true);
    loader.finish(["a"]);
    await retry;
    expect(clock.pending()).toEqual([RETRY_ROUNDS_MS[0]]);
    mode = "manual";
    const starts = loader.starts;
    clock.fire();
    expect(loader.starts).toBe(starts);
    expect(loader.keys()).toEqual([]);
    expect(watch.failures()[0]?.rounds).toBe(0);
  });

  it("settles retry on disposal and ignores stale timers and all later retry calls", async () => {
    const { clock, loader, watch } = setup(({ key }) =>
      key === "required" ? "manual" : "automatic",
    );
    let stale: (() => void) | undefined;
    const set = clock.timer.setTimeout;
    vi.spyOn(clock.timer, "setTimeout").mockImplementation((handler, ms) => {
      stale = handler;
      return set(handler, ms);
    });
    loader.add("json", "required", "required.json");
    loader.add("json", "optional", "optional.json");
    loader.start();
    loader.finish(["required", "optional"]);
    const retry = watch.retryFailures(({ key }) => key === "required");
    watch.dispose();
    await retry;
    const starts = loader.starts,
      keys = loader.keys();
    stale?.();
    const select = vi.fn(() => true);
    await watch.retryFailures(select);
    watch.waitFor("boot");
    watch.dispose();
    expect(select).not.toHaveBeenCalled();
    expect(loader.starts).toBe(starts);
    expect(loader.keys()).toEqual(keys);
    expect(watch.failures()).toEqual([]);
    expect(watch.waited()).toBeUndefined();
    expect(clock.pending()).toEqual([]);
  });

  it("retains a failure classified manual on the last automatic round for further explicit retries", async () => {
    let manual = false;
    const { clock, loader, watch } = setup(() => (manual ? "manual" : "automatic"));
    loader.bitmapFont("pixel", "pixel.png", "pixel.xml");
    loader.start();
    loader.finish(["pixel"]);
    for (let index = 0; index < RETRY_ROUNDS_MS.length; index++) {
      clock.fire();
      manual = index === RETRY_ROUNDS_MS.length - 1;
      loader.finish(["pixel"]);
    }
    expect(watch.failures()[0]?.rounds).toBe(RETRY_ROUNDS_MS.length);
    expect(clock.pending()).toEqual([]);
    const retry = watch.retryFailures(() => true);
    loader.finish(["pixel"]);
    await retry;
    expect(watch.failures()[0]?.rounds).toBe(RETRY_ROUNDS_MS.length);
    expect(clock.pending()).toEqual([]);
  });

  it("restores loader context and retains a failure when its queue method throws", async () => {
    const { loader, watch } = setup(() => "manual");
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish(["a"]);
    loader.baseURL = "https://assets.invalid/";
    loader.path = "later/";
    loader.prefix = "later.";
    const failure = watch.failures()[0];
    const queue = vi.spyOn(loader, "json").mockImplementation(() => {
      throw new Error("queue");
    });
    await expect(watch.retryFailures(() => true)).rejects.toThrow("queue");
    expect([loader.baseURL, loader.path, loader.prefix]).toEqual([
      "https://assets.invalid/",
      "later/",
      "later.",
    ]);
    expect(watch.failures()).toEqual([failure]);
    queue.mockRestore();
    const retry = watch.retryFailures(() => true);
    loader.finish();
    await retry;
    expect(watch.failures()).toEqual([]);
  });

  it("gives every queued file the loader's timeout and keeps a file's own", () => {
    const loader = new FakeLoader();
    const before = loader.add("json", "early", "early.json");
    const scene = { events: new EventEmitter(), load: loader } as unknown as Scene;
    watchLoader({ console, progress: createProgressState(), timer: fakeTimer().timer }, scene);
    const after = loader.add("image", "late", "late.png");
    const own = loader.add("image", "own", "own.png", undefined, 5000);
    expect([before, after, own].map((file) => file.xhrSettings.timeout)).toEqual([
      30_000, 30_000, 5000,
    ]);
  });

  it("reports nothing for a run no waitFor marked", () => {
    const { begin, loader } = setup();
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish();
    expect(begin).not.toHaveBeenCalled();
  });

  it("measures the next run from 0 after waitFor, never moving back, and finishes at 1", () => {
    const { loader, seen, values, watch } = setup();
    watch.waitFor("boot");
    expect(watch.waited()).toBe("boot");
    const a = loader.add("json", "a", "a.json");
    const b = loader.add("json", "b", "b.json");
    loader.start();
    loader.settle(a, true);
    // Two more files join: Phaser's own fraction would fall from 1/2 to 1/4.
    const c = loader.add("image", "c", "c.png");
    const d = loader.add("image", "d", "d.png");
    loader.settle(b, true);
    loader.settle(c, true);
    loader.settle(d, false);
    loader.complete();
    const rounded = values().map((value) => (value === undefined ? value : value.toFixed(3)));
    expect(rounded).toEqual([undefined, "0.000", "0.500", "0.667", "0.833", "1.000"]);
    expect(seen.at(-1)).toEqual({ active: false, value: undefined });
    expect(watch.waited()).toBeUndefined();
  });

  it("joins a run under way from its share so far", () => {
    const { begin, loader, values, watch } = setup();
    const a = loader.add("json", "a", "a.json");
    loader.add("json", "b", "b.json");
    loader.start();
    loader.settle(a, true);
    expect(begin).not.toHaveBeenCalled();
    watch.waitFor("level");
    expect(watch.waited()).toBe("level");
    expect(values().at(-1)).toBe(0.5);
    loader.finish();
    expect(values().at(-1)).toBe(1);
  });

  it("keeps a measured run's label and lets a later mark replace an earlier one", () => {
    const { loader, watch } = setup();
    watch.waitFor("level");
    watch.waitFor("boot");
    loader.add("json", "a", "a.json");
    loader.start();
    watch.waitFor("level");
    expect(watch.waited()).toBe("boot");
  });

  it("begins and ends an empty marked run at once, leaving no mark for the next", () => {
    const { begin, loader, seen, watch } = setup();
    watch.waitFor("boot");
    loader.start();
    expect(seen.slice(1)).toEqual([
      { active: true, value: undefined },
      { active: true, value: 0 },
      { active: true, value: 1 },
      { active: false, value: undefined },
    ]);
    expect(watch.waited()).toBeUndefined();
    loader.add("json", "later", "later.json");
    loader.start();
    loader.finish();
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("schedules no retry round after a run without failures", () => {
    const { clock, loader, warn } = setup();
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish();
    expect(clock.pending()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs each failed file once and queues it again in silent rounds until it gives up", () => {
    const { begin, clock, loader, warn, watch } = setup();
    loader.path = "art/";
    loader.prefix = "game.";
    watch.waitFor("boot");
    loader.svg("ship", "ship.svg", { scale: 2 });
    loader.add("json", "ok", "ok.json");
    loader.start();
    loader.finish(["game.ship"]);
    expect(warn.mock.calls).toEqual([
      ["Loading art/ship.svg failed after 3 attempts; retrying later"],
    ]);
    expect(watch.failures()).toEqual([
      { config: { scale: 2 }, key: "game.ship", rounds: 0, type: "svg", url: "art/ship.svg" },
    ]);
    for (const [index, ms] of RETRY_ROUNDS_MS.entries()) {
      expect(clock.pending()).toEqual([ms]);
      const starts = loader.starts;
      clock.fire();
      // Queued again with the key and URL it had, under the loader's own path and prefix.
      expect(loader.keys()).toEqual(["game.ship"]);
      expect([...loader.list].map(({ config, url }) => [url, config])).toEqual([
        ["art/ship.svg", { scale: 2 }],
      ]);
      expect([loader.path, loader.prefix]).toEqual(["art/", "game."]);
      expect(loader.starts).toBe(starts + 1);
      expect(watch.failures()).toEqual([]);
      loader.finish(["game.ship"]);
      expect(warn).toHaveBeenCalledTimes(index + 2);
    }
    expect(warn.mock.calls.at(-1)).toEqual([
      "Loading art/ship.svg failed after 3 attempts in retry round 3; giving up",
    ]);
    expect(clock.pending()).toEqual([]);
    expect(watch.failures()).toEqual([]);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("queues each retryable type by its loader method and counts a single attempt", () => {
    const { clock, loader, warn, watch } = setup();
    const files = [
      loader.add("json", "data", "data.json", "levels"),
      loader.add("image", "sky", "sky.png"),
      loader.add("spritesheet", "dog", "dog.png", { frameWidth: 16 }),
    ];
    loader.start();
    for (const file of files) {
      loader.settle(file, false, 2);
    }
    loader.complete();
    expect(warn.mock.calls[0]).toEqual([
      "Loading data.json failed after 1 attempt; retrying later",
    ]);
    expect(watch.failures().map(({ type }) => type)).toEqual(["json", "image", "spritesheet"]);
    clock.fire();
    expect([...loader.list].map(({ config, key, type }) => [type, key, config])).toEqual([
      ["json", "data", "levels"],
      ["image", "sky", undefined],
      ["spritesheet", "dog", { frameWidth: 16 }],
    ]);
  });

  it("lets a later round's files join a busy loader's run instead of starting one", () => {
    const { clock, loader } = setup();
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish(["a"]);
    loader.add("json", "b", "b.json");
    loader.start();
    const starts = loader.starts;
    clock.fire();
    expect(loader.starts).toBe(starts);
    expect(loader.keys()).toEqual(["b", "a"]);
    expect(loader.totalToLoad).toBe(2);
  });

  it("re-records a file that fails again, and drops one that loads", () => {
    const { clock, loader, watch } = setup();
    loader.add("json", "a", "a.json");
    loader.add("json", "b", "b.json");
    loader.start();
    loader.finish(["a", "b"]);
    clock.fire();
    loader.finish(["a"]);
    expect(watch.failures()).toEqual([
      { config: undefined, key: "a", rounds: 1, type: "json", url: "a.json" },
    ]);
    expect(clock.pending()).toEqual([RETRY_ROUNDS_MS[1]]);
  });

  it("logs a file it cannot queue again, or of an unseen multi-file load, as not retried", () => {
    const { clock, loader, warn, watch } = setup();
    const part = loader.add("image", "atlas", "atlas.png");
    part.multiFile = {};
    const audio = loader.add("audio", "theme", "theme.ogg");
    loader.start();
    loader.settle(part, false);
    loader.settle(audio, false);
    loader.complete();
    expect(warn.mock.calls).toEqual([
      ["Loading atlas.png failed after 3 attempts; not retried"],
      ["Loading theme.ogg failed after 3 attempts; not retried"],
    ]);
    expect(watch.failures()).toEqual([]);
    expect(clock.pending()).toEqual([]);
  });

  it("gives every file of a multi-file load the loader's timeout", () => {
    const loader = new FakeLoader();
    loader.bitmapFont("early", "early.png", "early.xml");
    const scene = { events: new EventEmitter(), load: loader } as unknown as Scene;
    watchLoader({ console, progress: createProgressState(), timer: fakeTimer().timer }, scene);
    loader.aseprite("late", "late.png", "late.json");
    expect([...loader.list].map((file) => file.xhrSettings.timeout)).toEqual([
      30_000, 30_000, 30_000, 30_000,
    ]);
  });

  it.each([
    {
      call: (loader: FakeLoader) => loader.bitmapFont("pixel", "pixel.png", "pixel.xml"),
      config: ["pixel", "pixel.png", "pixel.xml"],
      failing: "art/pixel.png",
      method: "bitmapFont",
      queued: [
        ["image", "ui.pixel", "art/pixel.png"],
        ["xml", "ui.pixel", "art/pixel.xml"],
      ],
    },
    {
      call: (loader: FakeLoader) => loader.aseprite("pixel", "pixel.png", "pixel.json"),
      config: ["pixel", "pixel.png", "pixel.json"],
      failing: "art/pixel.json",
      method: "aseprite",
      queued: [
        ["image", "ui.pixel", "art/pixel.png"],
        ["json", "ui.pixel", "art/pixel.json"],
      ],
    },
  ])("queues a failed $method load again whole in a silent round", (example) => {
    const { call, config, failing, method, queued } = example;
    const { begin, clock, loader, values, warn, watch } = setup();
    loader.path = "art/";
    loader.prefix = "ui.";
    watch.waitFor("boot");
    call(loader);
    const [first] = [...loader.list];
    loader.start();
    loader.finish([failing]);
    // The run counts each file of the load, as Phaser does.
    expect(values()).toEqual([undefined, 0, 0.5, 1]);
    expect(warn.mock.calls).toEqual([
      [`Loading ${failing} failed after 3 attempts; retrying later`],
    ]);
    expect(watch.failures()).toEqual([
      { config, key: "ui.pixel", rounds: 0, type: method, url: failing },
    ]);
    expect(clock.pending()).toEqual([RETRY_ROUNDS_MS[0]]);
    loader.path = "other/";
    loader.prefix = "other.";
    const starts = loader.starts;
    clock.fire();
    // Every file of the load again, under the path and prefix it was first queued with, in one
    // new MultiFile.
    expect(loader.queued()).toEqual(queued);
    const parents = new Set([...loader.list].map(({ multiFile }) => multiFile));
    expect(parents.size).toBe(1);
    expect(parents.has(first?.multiFile ?? null)).toBe(false);
    expect([loader.path, loader.prefix]).toEqual(["other/", "other."]);
    expect(loader.starts).toBe(starts + 1);
    expect(watch.failures()).toEqual([]);
    loader.finish();
    expect(clock.pending()).toEqual([]);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("records a multi-file load once when several of its files fail, and queues it once", () => {
    const { clock, loader, warn, watch } = setup();
    loader.bitmapFont("pixel", "pixel.png", "pixel.xml");
    loader.start();
    loader.finish(["pixel"]);
    expect(warn.mock.calls).toEqual([
      ["Loading pixel.png failed after 3 attempts; retrying later"],
      ["Loading pixel.xml failed after 3 attempts; retrying later"],
    ]);
    expect(watch.failures().map(({ type, url }) => [type, url])).toEqual([
      ["bitmapFont", "pixel.png"],
    ]);
    clock.fire();
    expect(loader.queued()).toEqual([
      ["image", "pixel", "pixel.png"],
      ["xml", "pixel", "pixel.xml"],
    ]);
  });

  it("gives up a multi-file load that fails its third round", () => {
    const { clock, loader, warn, watch } = setup();
    loader.bitmapFont("pixel", "pixel.png", "pixel.xml");
    loader.start();
    loader.finish(["pixel"]);
    for (const [index, ms] of RETRY_ROUNDS_MS.entries()) {
      expect(clock.pending()).toEqual([ms]);
      expect(watch.failures().map(({ rounds }) => rounds)).toEqual([index]);
      clock.fire();
      expect(loader.list.size).toBe(2);
      loader.finish(["pixel"]);
    }
    expect(warn.mock.calls.slice(-2)).toEqual([
      ["Loading pixel.png failed after 3 attempts in retry round 3; giving up"],
      ["Loading pixel.xml failed after 3 attempts in retry round 3; giving up"],
    ]);
    expect(warn).toHaveBeenCalledTimes(8);
    expect(clock.pending()).toEqual([]);
    expect(watch.failures()).toEqual([]);
  });

  it("queues again only the failed load of a call given several configs", () => {
    const { clock, loader, watch } = setup();
    loader.bitmapFont([
      { fontDataURL: "a.xml", key: "a", textureURL: "a.png" },
      { fontDataURL: "b.xml", key: "b", textureURL: "b.png" },
    ]);
    loader.start();
    loader.finish(["a.png"]);
    expect(watch.failures().map(({ config }) => config)).toEqual([
      [{ fontDataURL: "a.xml", key: "a", textureURL: "a.png" }],
    ]);
    clock.fire();
    expect(loader.queued()).toEqual([
      ["image", "a", "a.png"],
      ["xml", "a", "a.xml"],
    ]);
  });

  it("wraps each multi-file method while it lasts and restores it on dispose", () => {
    const atlas = vi.fn<(...args: unknown[]) => unknown>();
    const loader = Object.assign(new FakeLoader(), { atlas });
    const scene = { events: new EventEmitter(), load: loader } as unknown as Scene;
    const warn = vi.fn<(message: string) => void>();
    const progress = createProgressState();
    const watch = watchLoader({ console: { warn }, progress, timer: fakeTimer().timer }, scene);
    expect(Object.hasOwn(loader, "bitmapFont")).toBe(true);
    expect(loader.atlas("sky", "sky.png", "sky.json")).toBe(loader);
    expect(atlas.mock.calls).toEqual([["sky", "sky.png", "sky.json"]]);
    expect(atlas.mock.contexts).toEqual([loader]);
    watch.dispose();
    expect(Object.hasOwn(loader, "bitmapFont")).toBe(false);
    expect(loader.atlas).toBe(atlas);
    // A load queued after dispose is no longer watched.
    loader.bitmapFont("pixel", "pixel.png", "pixel.xml");
    loader.start();
    loader.finish(["pixel"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops on scene shutdown: no round, a measured run finished, no more listening", () => {
    const { begin, clock, events, loader, seen, watch } = setup();
    loader.add("json", "a", "a.json");
    loader.start();
    loader.finish(["a"]);
    watch.waitFor("level");
    loader.add("json", "b", "b.json");
    loader.start();
    events.emit(Scenes.Events.SHUTDOWN);
    expect(clock.pending()).toEqual([]);
    expect(seen.at(-1)).toEqual({ active: false, value: undefined });
    for (const event of Object.values(Loader.Events)) {
      expect(loader.listenerCount(event as string)).toBe(0);
    }
    watch.waitFor("boot");
    loader.finish();
    loader.start();
    expect(begin).toHaveBeenCalledTimes(1);
  });
});
