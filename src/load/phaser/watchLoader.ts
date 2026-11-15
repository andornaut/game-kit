import { Loader, type Scene, Scenes, type Types } from "phaser";

import type { Timer } from "../../clock/timer.ts";
import type { ProgressHandle } from "../../progressState.ts";
import { createFileShare } from "../fileShare.ts";
import { RETRY_ROUNDS_MS } from "../loaderConfig.ts";

// Phaser 4.2.1's loader methods that queue a multi-file load, which a retry round queues again
// whole.
export const MULTI_FILE_METHODS = [
  "aseprite",
  "atlas",
  "atlasPCT",
  "atlasXML",
  "audioSprite",
  "bitmapFont",
  "multiatlas",
  "scripts",
  "texture",
  "unityAtlas",
] as const;

export type MultiFileMethod = (typeof MULTI_FILE_METHODS)[number];

// The loads a retry round can queue again, by their loader method.
export type RetryableType = "image" | "json" | "spritesheet" | "svg" | "xml" | MultiFileMethod;

// A load whose last attempt failed, waiting for its next retry round. For a single file, key and
// url are the file's as the loader resolved them against its prefix and path, and config its
// type's options: a JSON file's data key, an SVG's size or a sprite sheet's frames. For a
// multi-file load, key is the load's key with its prefix, config the arguments its loader method
// was called with, and url that of its first file that failed. rounds counts the retry rounds
// already run for it; explicit retries do not increment rounds.
export interface LoadFailure {
  readonly config: unknown;
  readonly key: string;
  readonly rounds: number;
  readonly type: RetryableType;
  readonly url: string;
}

export interface LoaderWatch<Label extends string> {
  // Clears the scene's loader's listeners, restores its multi-file methods, cancels any retry
  // round and finishes a measured run.
  dispose(): void;
  // The failed logical loads waiting for an automatic or explicit retry, oldest first.
  failures(): readonly LoadFailure[];
  // Retry selected recorded logical loads, sharing the current retry flight. Settles on loader
  // COMPLETE or disposal, including another failed attempt; inspect failures for the outcome.
  // Predicate errors reject that call before queueing; queue errors reject the shared flight.
  // Neither spends an automatic round.
  retryFailures(select: (failure: LoadFailure) => boolean): Promise<void>;
  // Marks a load the player waits for, which reports to the progress state: the loader's run
  // under way, from its share so far, or else its next run, from 0. A run already measured keeps
  // its label; a later mark before a run starts replaces an earlier one.
  waitFor(label: Label): void;
  // The label of the measured run under way, or else of the mark waiting for the next run.
  waited(): Label | undefined;
}

interface Run {
  done: number;
  readonly share: (done: number, total: number) => number;
  total: number;
}

// One multi-file load as its loader method was called: the arguments and the loader's base URL,
// path and prefix at the call, and the retry rounds already run for it.
interface MultiLoad {
  readonly args: readonly unknown[];
  readonly baseURL: string;
  readonly method: MultiFileMethod;
  readonly path: string;
  readonly prefix: string;
  readonly rounds: number;
}

// A multi-file load in flight, and how its failure was logged once one of its files failed.
interface MultiEntry {
  readonly load: MultiLoad;
  verdict?: string;
}

interface XMLLoad {
  readonly baseURL: string;
  readonly rounds: number;
  readonly xhrSettings: Types.Loader.XHRSettingsObject;
}

interface Recorded {
  readonly failure: LoadFailure;
  readonly load?: MultiLoad;
  readonly xml?: XMLLoad;
}

const retryableType = (file: Loader.File): RetryableType | undefined => {
  if (file.multiFile || file.linkFile || typeof file.url !== "string") {
    return undefined;
  }
  switch (file.type) {
    case "image":
    case "json":
    case "spritesheet":
    case "svg":
    case "xml":
      return file.type;
    default:
      return undefined;
  }
};

const queueAgain = (
  loader: Loader.LoaderPlugin,
  xml: XMLLoad | undefined,
  failure: LoadFailure,
) => {
  const { config, key, type, url } = failure;
  switch (type) {
    case "image":
      loader.image(key, url);
      break;
    case "json":
      loader.json(key, url, typeof config === "string" ? config : undefined);
      break;
    case "spritesheet":
      loader.spritesheet(key, url, config as Types.Loader.FileTypes.ImageFrameConfig);
      break;
    case "svg":
      loader.svg(key, url, config as Types.Loader.FileTypes.SVGSizeConfig);
      break;
    case "xml":
      if (xml === undefined) {
        throw new Error("XML retry requires its original ADD context");
      }
      loader.xml(key, url, xml.xhrSettings);
      break;
    default:
      break;
  }
};

const fileId = (type: string, key: string) => `${type}\u0000${key}`;

// Watches a scene's loader from now until the scene shuts down: create it in the scene's init
// or preload, before queueing the scene's files, each time the scene starts.
// - Every file the loader queues gets the loader's timeout (LOADER_CONFIG as the game config's
//   loader), so a request that never answers fails after its retries and its run completes.
//   That includes each file of a multi-file load.
// - Each run's measured share is createFileShare's: settled files, loaded or failed, out of the
//   run's total, never moving backward when the run queues more files. A multi-file load counts
//   each of its files, as Phaser counts them. Only a run that waitFor marked reports it, to a
//   handle from progress begun as the run starts (or when waitFor joins it), and finishes that
//   handle at 1 as the run completes, an empty run at once. Every other run, such as on-demand
//   art and the retry rounds, is silent.
// - Each file that fails after the loader's own retries is logged once with console.warn and
//   its load recorded, a multi-file load once however many of its files fail. When a run
//   completes with automatic recorded loads and no round is pending, a retry round is scheduled on timer
//   RETRY_ROUNDS_MS after it, by the fewest rounds any recorded load has had. The round queues
//   each still-automatic recorded load again, a single file by its type's loader method and a multi-file load
//   whole by the call that queued it, and starts the loader if it is idle; a busy loader takes
//   them into its run, and a run marked by waitFor is measured whoever starts it. A load that
//   fails again is recorded again, until it has failed its last round and is logged as given up.
//   A file of any other type, a linked file outside a multi-file load, or part of a multi-file
//   load queued before the watch or by another method, is logged as not retried.
// - retryMode can retain a logical failure for explicit retry instead. Classification is checked
//   again before an automatic round fires. Manual retries leave automatic budgets/timers intact,
//   queue only selected failures and share a flight through COMPLETE or disposal.
// - While the watch lasts, each MULTI_FILE_METHODS method on the loader is wrapped to capture
//   its arguments, base URL, path and prefix, one call per config when given an array of configs,
//   so a round queues each multi-file load again exactly as it was first queued.
// - Standalone XML captures its original base URL and resolved XHR settings at ADD. XML queued
//   before the watch has no captured context and is not retried.
// Scene shutdown or destroy disposes the watch.
export function watchLoader<Label extends string = string>(
  context: {
    readonly console: Pick<Console, "warn">;
    readonly progress: { begin(): ProgressHandle };
    // Classify a captured logical load, including original multi-file args and first failed URL.
    // A throwing classifier is treated as manual. Automatic is the default.
    readonly retryMode?: (failure: LoadFailure) => "automatic" | "manual";
    readonly timer: Timer;
  },
  scene: Pick<Scene, "events" | "load">,
): LoaderWatch<Label> {
  const { console, progress, timer } = context;
  const loader = scene.load;
  const methods = loader as unknown as Record<string, unknown>;
  const recorded = new Map<string, Recorded>();
  // Single files a round queued again, by id, with the rounds run for them.
  const retrying = new Map<string, number>();
  const queued = new Set<string>();
  let xmlLoads = new WeakMap<Loader.File, XMLLoad>();
  const xmlDispatch = new Map<Loader.File, () => void>();
  const xmlProcessing = new Map<Loader.File, () => void>();
  let disposed = false;
  let retryFlight: Promise<void> | undefined;
  let finishRetry: (() => void) | undefined;
  let failRetry: ((error: unknown) => void) | undefined;
  let queueDepth = 0;
  let multiLoads = new WeakMap<Loader.MultiFile, MultiEntry>();
  // The multi-file load whose loader method is running, which its files' ADD events join.
  let queuing: MultiLoad | undefined;
  let run: Run | undefined;
  let measured: { handle: ProgressHandle; label: Label } | undefined;
  let marked: Label | undefined;
  let round: unknown;
  let roundPending = false;

  const automatic = (failure: LoadFailure) => {
    try {
      return context.retryMode === undefined || context.retryMode(failure) === "automatic";
    } catch {
      // A classification failure retains the load for explicit retry, never an automatic round.
      return false;
    }
  };

  const share = () => (run === undefined ? 0 : run.share(run.done, run.total));
  const report = () => measured?.handle.progress(share());
  const measure = (label: Label) => {
    measured = { handle: progress.begin(), label };
    report();
  };

  // WORKAROUND: Phaser 4.2.1 gives each file its own xhrSettings whose timeout of 0 overrides
  // the loader's, so the game config's loader.timeout never reaches a request.
  // https://github.com/phaserjs/phaser/blob/v4.2.1/src/loader/File.js#L133
  const applyTimeout = (file: Loader.File) => {
    if (!file.xhrSettings.timeout) {
      file.xhrSettings.timeout = loader.xhr.timeout ?? 0;
    }
  };

  const originals = new Map<MultiFileMethod, (...args: unknown[]) => unknown>();
  const queueMulti = (load: MultiLoad) => {
    const original = originals.get(load.method);
    if (original === undefined) {
      return;
    }
    const outer = queuing;
    queuing = load;
    try {
      Reflect.apply(original, loader, load.args);
    } finally {
      queuing = disposed ? undefined : outer;
    }
  };
  const wrapped = MULTI_FILE_METHODS.flatMap((method) => {
    const original = methods[method];
    if (typeof original !== "function") {
      return [];
    }
    originals.set(method, original as (...args: unknown[]) => unknown);
    const own = Object.getOwnPropertyDescriptor(loader, method);
    methods[method] = (...args: unknown[]) => {
      if (disposed) {
        return loader;
      }
      const calls = Array.isArray(args[0]) ? args[0].map((config: unknown) => [config]) : [args];
      const { baseURL, path, prefix } = loader;
      for (const call of calls) {
        queueMulti({ args: call, baseURL, method, path, prefix, rounds: 0 });
      }
      return loader;
    };
    return [{ method, own }];
  });

  const queueLoads = (loads: readonly (readonly [string, Recorded])[], increment: number) => {
    const { baseURL, path, prefix } = loader;
    let count = 0;
    queueDepth += 1;
    try {
      for (const [id, entry] of loads) {
        if (disposed) {
          break;
        }
        if (queued.has(id) || recorded.get(id) !== entry) {
          continue;
        }
        const { failure, load } = entry;
        recorded.delete(id);
        queued.add(id);
        try {
          if (load === undefined) {
            // Recorded single-file keys and URLs already carry their original prefix and path.
            loader.path = "";
            loader.prefix = "";
            loader.baseURL = entry.xml?.baseURL ?? baseURL;
            retrying.set(id, failure.rounds + increment);
            queueAgain(loader, entry.xml, failure);
          } else {
            loader.baseURL = load.baseURL;
            loader.path = load.path;
            loader.prefix = load.prefix;
            queueMulti({ ...load, rounds: load.rounds + increment });
          }
          count += 1;
        } catch (error) {
          if (!disposed) {
            queued.delete(id);
            retrying.delete(id);
            recorded.set(id, entry);
          }
          throw error;
        }
      }
    } finally {
      loader.baseURL = baseURL;
      loader.path = path;
      loader.prefix = prefix;
      queueDepth -= 1;
    }
    return count;
  };
  const automaticLoads = () =>
    [...recorded.entries()].filter(
      ([, { failure }]) => automatic(failure) && failure.rounds < RETRY_ROUNDS_MS.length,
    );
  const runRound = () => {
    if (disposed) {
      return;
    }
    roundPending = false;
    const count = queueLoads(automaticLoads(), 1);
    if (!disposed && count > 0 && !loader.isLoading()) {
      loader.start();
    }
  };

  const onAdd = (_key: string, _type: string, _loader: unknown, file: Loader.File) => {
    if (disposed) {
      return;
    }
    applyTimeout(file);
    if (retryableType(file) === "xml") {
      // Native XML URLs include path but exclude baseURL; keys already include prefix.
      const { headers, ...settings } = file.xhrSettings;
      xmlLoads.set(file, {
        baseURL: loader.baseURL,
        rounds: retrying.get(fileId(file.type, file.key)) ?? 0,
        xhrSettings: { ...settings, ...(headers === undefined ? {} : { headers: { ...headers } }) },
      });
      const processError = file.onProcessError;
      const processComplete = file.onProcessComplete;
      const ownError = Object.getOwnPropertyDescriptor(file, "onProcessError");
      const ownComplete = Object.getOwnPropertyDescriptor(file, "onProcessComplete");
      const restoreProcessing = () => {
        for (const [method, own] of [
          ["onProcessError", ownError],
          ["onProcessComplete", ownComplete],
        ] as const) {
          if (own === undefined) {
            Reflect.deleteProperty(file, method);
          } else {
            Object.defineProperty(file, method, own);
          }
        }
        xmlProcessing.delete(file);
      };
      xmlProcessing.set(file, restoreProcessing);
      file.onProcessError = function () {
        restoreProcessing();
        if (!disposed) {
          // FILE_LOAD already counted network settlement. Record before native COMPLETE.
          const verdict = singleVerdict(file);
          console.warn(`Processing ${String(file.url)} failed${verdict}`);
        }
        return processError.call(this);
      };
      file.onProcessComplete = function () {
        restoreProcessing();
        return processComplete.call(this);
      };
      if (retrying.has(fileId(file.type, file.key))) {
        // File.load reads the shared baseURL at dispatch, including native XHR retries.
        const base = loader.baseURL;
        const own = Object.getOwnPropertyDescriptor(file, "load");
        const load = file.load;
        file.load = function () {
          const current = loader.baseURL;
          try {
            loader.baseURL = base;
            return load.call(this);
          } finally {
            loader.baseURL = current;
          }
        };
        xmlDispatch.set(file, () => {
          if (own === undefined) {
            Reflect.deleteProperty(file, "load");
          } else {
            Object.defineProperty(file, "load", own);
          }
          xmlDispatch.delete(file);
        });
      }
    }
    const multi = file.multiFile;
    if (multi && queuing !== undefined && !multiLoads.has(multi)) {
      multiLoads.set(multi, { load: queuing });
    }
    if (run !== undefined) {
      run.total += 1;
      report();
    }
  };
  const onStart = () => {
    if (disposed) {
      return;
    }
    run = { done: 0, share: createFileShare(), total: loader.list.size };
    if (marked !== undefined) {
      const label = marked;
      marked = undefined;
      measure(label);
    }
  };
  const onLoad = (file: Loader.File) => {
    if (disposed) {
      return;
    }
    xmlDispatch.get(file)?.();
    retrying.delete(fileId(file.type, file.key));
    if (run !== undefined) {
      run.done += 1;
      report();
    }
  };
  // How a failed multi-file load's files are logged: its first failed file records the load, or
  // gives it up after its last round, and every later one is logged the same way.
  const multiVerdict = (entry: MultiEntry, file: Loader.File, multi: Loader.MultiFile) => {
    if (entry.verdict !== undefined) {
      return entry.verdict;
    }
    const { load } = entry;
    const failure: LoadFailure = {
      config: load.args,
      key: multi.key,
      rounds: load.rounds,
      type: load.method,
      url: String(file.url),
    };
    const auto = automatic(failure);
    if (auto && load.rounds >= RETRY_ROUNDS_MS.length) {
      entry.verdict = ` in retry round ${load.rounds}; giving up`;
    } else {
      entry.verdict = auto ? "; retrying later" : "; waiting for manual retry";
      recorded.set(fileId(load.method, multi.key), { failure, load });
    }
    return entry.verdict;
  };
  const singleVerdict = (file: Loader.File) => {
    const id = fileId(file.type, file.key);
    const rounds = xmlLoads.get(file)?.rounds ?? retrying.get(id) ?? 0;
    retrying.delete(id);
    const type = retryableType(file);
    const xml = type === "xml" ? xmlLoads.get(file) : undefined;
    if (type === undefined || (type === "xml" && xml === undefined)) {
      return "; not retried";
    }
    const failure = { config: file.config, key: file.key, rounds, type, url: String(file.url) };
    const auto = automatic(failure);
    if (auto && rounds >= RETRY_ROUNDS_MS.length) {
      return ` in retry round ${rounds}; giving up`;
    }
    recorded.set(id, { failure, ...(xml === undefined ? {} : { xml }) });
    return auto ? "; retrying later" : "; waiting for manual retry";
  };
  const onError = (file: Loader.File) => {
    if (disposed) {
      return;
    }
    xmlDispatch.get(file)?.();
    xmlProcessing.get(file)?.();
    if (run !== undefined) {
      run.done += 1;
      report();
    }
    const attempts = Math.max(1, 1 + loader.maxRetries - file.retryAttempts);
    const plural = attempts === 1 ? "" : "s";
    const multi = file.multiFile;
    let verdict: string;
    if (multi) {
      const entry = multiLoads.get(multi);
      verdict = entry === undefined ? "; not retried" : multiVerdict(entry, file, multi);
    } else {
      verdict = singleVerdict(file);
    }
    console.warn(`Loading ${String(file.url)} failed after ${attempts} attempt${plural}${verdict}`);
  };
  const onComplete = () => {
    if (disposed) {
      return;
    }
    for (const restore of xmlDispatch.values()) {
      restore();
    }
    for (const restore of xmlProcessing.values()) {
      restore();
    }
    run = undefined;
    queued.clear();
    const finish = finishRetry;
    retryFlight = undefined;
    finishRetry = undefined;
    failRetry = undefined;
    try {
      const ending = measured;
      if (ending !== undefined) {
        ending.handle.progress(1);
        ending.handle.finish();
        if (measured === ending) {
          measured = undefined;
        }
      }
      const loads = disposed ? [] : automaticLoads();
      if (!disposed && loads.length > 0 && !roundPending) {
        const fewest = Math.min(...loads.map(([, { failure }]) => failure.rounds));
        roundPending = true;
        round = timer.setTimeout(runRound, RETRY_ROUNDS_MS[fewest] ?? 0);
      }
    } finally {
      finish?.();
    }
  };

  const listeners = [
    [Loader.Events.ADD, onAdd],
    [Loader.Events.START, onStart],
    [Loader.Events.FILE_LOAD, onLoad],
    [Loader.Events.FILE_LOAD_ERROR, onError],
    [Loader.Events.COMPLETE, onComplete],
  ] as const;
  for (const [event, listener] of listeners) {
    loader.on(event, listener);
  }
  loader.list.forEach(applyTimeout);
  if (loader.isLoading()) {
    const done = loader.totalComplete + loader.totalFailed;
    run = { done, share: createFileShare(), total: loader.totalToLoad };
  }

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const [event, listener] of listeners) {
      loader.off(event, listener);
    }
    for (const { method, own } of wrapped) {
      if (own === undefined) {
        Reflect.deleteProperty(loader, method);
      } else {
        Object.defineProperty(loader, method, own);
      }
    }
    wrapped.length = 0;
    originals.clear();
    scene.events.off(Scenes.Events.SHUTDOWN, dispose);
    scene.events.off(Scenes.Events.DESTROY, dispose);
    if (roundPending) {
      timer.clearTimeout(round);
      roundPending = false;
    }
    const ending = measured;
    measured = undefined;
    marked = undefined;
    run = undefined;
    queuing = undefined;
    multiLoads = new WeakMap();
    xmlLoads = new WeakMap();
    for (const restore of xmlDispatch.values()) {
      restore();
    }
    for (const restore of xmlProcessing.values()) {
      restore();
    }
    recorded.clear();
    retrying.clear();
    queued.clear();
    finishRetry?.();
    retryFlight = undefined;
    finishRetry = undefined;
    failRetry = undefined;
    ending?.handle.finish();
  };
  scene.events.once(Scenes.Events.SHUTDOWN, dispose);
  scene.events.once(Scenes.Events.DESTROY, dispose);

  return {
    dispose,
    failures: () => [...recorded.values()].map(({ failure }) => failure),
    retryFailures(select) {
      if (disposed) {
        return Promise.resolve();
      }
      let selected: [string, Recorded][];
      try {
        // Finish every predicate evaluation before deleting records or queueing any load.
        selected = [...recorded.entries()].filter(([, { failure }]) => select(failure));
      } catch (error) {
        return Promise.reject(error);
      }
      if (disposed) {
        return Promise.resolve();
      }
      if (retryFlight === undefined && selected.length === 0) {
        return Promise.resolve();
      }
      if (retryFlight === undefined) {
        retryFlight = new Promise<void>((resolve, reject) => {
          finishRetry = resolve;
          failRetry = reject;
        });
      }
      const pending = retryFlight;
      try {
        const count = queueLoads(selected, 0);
        if (!disposed && count > 0 && queueDepth === 0 && !loader.isLoading()) {
          loader.start();
        }
      } catch (error) {
        if (retryFlight === pending) {
          const fail = failRetry;
          retryFlight = undefined;
          finishRetry = undefined;
          failRetry = undefined;
          fail?.(error);
        }
      }
      return pending;
    },
    waitFor(label) {
      if (disposed || measured !== undefined) {
        return;
      }
      if (run === undefined) {
        marked = label;
      } else {
        measure(label);
      }
    },
    waited: () => measured?.label ?? marked,
  };
}
