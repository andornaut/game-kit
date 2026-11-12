import { EventEmitter } from "node:events";

import { Loader, type Scene, Scenes, type Types } from "phaser";
import { describe, expect, it, vi } from "vitest";

import type { Timer } from "../../clock/timer.ts";
import { createProgressState, type ProgressSnapshot } from "../../progressState.ts";
import { LOADER_CONFIG, RETRY_ROUNDS_MS } from "../loaderConfig.ts";
import { watchLoader } from "./watchLoader.ts";

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

interface FakeFile {
  config: unknown;
  key: string;
  linkFile: FakeFile | null;
  multiFile: object | null;
  retryAttempts: number;
  type: string;
  url: string;
  xhrSettings: { timeout?: number };
}

// Phaser's LoaderPlugin as the watch sees it: an emitter of Phaser's loader events with its
// queue, totals, path, prefix and XHR settings. start, settle and complete play a run.
class FakeLoader extends EventEmitter {
  readonly list = new Set<FakeFile>();
  loading = false;
  maxRetries: number = LOADER_CONFIG.maxRetries;
  path = "";
  prefix = "";
  starts = 0;
  totalComplete = 0;
  totalFailed = 0;
  totalToLoad = 0;
  readonly xhr = { timeout: LOADER_CONFIG.timeout };

  add(type: string, key: string, url: string, config?: unknown, timeout = 0): FakeFile {
    const file: FakeFile = {
      config,
      key: this.prefix + key,
      linkFile: null,
      multiFile: null,
      retryAttempts: this.maxRetries,
      type,
      url: this.path + url,
      xhrSettings: { timeout },
    };
    this.list.add(file);
    this.emit(Loader.Events.ADD, file.key, type, this, file);
    if (this.loading) {
      this.totalToLoad += 1;
    }
    return file;
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
  // Settles every queued file as loaded, or the files named in failing as failed, then completes.
  finish(failing: readonly string[] = []) {
    for (const file of [...this.list]) {
      this.settle(file, !failing.includes(file.key));
    }
    this.complete();
  }
  keys() {
    return [...this.list].map((file) => file.key);
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

function setup() {
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
    { console: { warn }, progress, timer: clock.timer },
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

  it("logs a file it cannot queue again as not retried", () => {
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
