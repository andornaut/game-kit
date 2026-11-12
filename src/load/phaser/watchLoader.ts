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
export type RetryableType = "image" | "json" | "spritesheet" | "svg" | MultiFileMethod;

// A load whose last attempt failed, waiting for its next retry round. For a single file, key and
// url are the file's as the loader resolved them against its prefix and path, and config its
// type's options: a JSON file's data key, an SVG's size or a sprite sheet's frames. For a
// multi-file load, key is the load's key with its prefix, config the arguments its loader method
// was called with, and url that of its first file that failed. rounds counts the retry rounds
// already run for it.
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
  // The failed loads waiting for their next retry round, oldest first.
  failures(): readonly LoadFailure[];
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

interface Recorded {
  readonly failure: LoadFailure;
  readonly load?: MultiLoad;
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
      return file.type;
    default:
      return undefined;
  }
};

const queueAgain = (loader: Loader.LoaderPlugin, failure: LoadFailure) => {
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
//   completes with recorded loads and no round is pending, a retry round is scheduled on timer
//   RETRY_ROUNDS_MS after it, by the fewest rounds any recorded load has had. The round queues
//   every recorded load again, a single file by its type's loader method and a multi-file load
//   whole by the call that queued it, and starts the loader if it is idle; a busy loader takes
//   them into its run, and a run marked by waitFor is measured whoever starts it. A load that
//   fails again is recorded again, until it has failed its last round and is logged as given up.
//   A file of any other type, a linked file outside a multi-file load, or part of a multi-file
//   load queued before the watch or by another method, is logged as not retried.
// - While the watch lasts, each MULTI_FILE_METHODS method on the loader is wrapped to capture
//   its arguments, base URL, path and prefix, one call per config when given an array of configs,
//   so a round queues each multi-file load again exactly as it was first queued.
// Scene shutdown or destroy disposes the watch.
export function watchLoader<Label extends string = string>(
  context: {
    readonly console: Pick<Console, "warn">;
    readonly progress: { begin(): ProgressHandle };
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
  let multiLoads = new WeakMap<Loader.MultiFile, MultiEntry>();
  // The multi-file load whose loader method is running, which its files' ADD events join.
  let queuing: MultiLoad | undefined;
  let run: Run | undefined;
  let measured: { handle: ProgressHandle; label: Label } | undefined;
  let marked: Label | undefined;
  let round: unknown;
  let roundPending = false;

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
      queuing = outer;
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
      const calls = Array.isArray(args[0]) ? args[0].map((config: unknown) => [config]) : [args];
      const { baseURL, path, prefix } = loader;
      for (const call of calls) {
        queueMulti({ args: call, baseURL, method, path, prefix, rounds: 0 });
      }
      return loader;
    };
    return [{ method, own }];
  });

  const runRound = () => {
    roundPending = false;
    const loads = [...recorded.entries()];
    recorded.clear();
    const { baseURL, path, prefix } = loader;
    for (const [id, { failure, load }] of loads) {
      if (load === undefined) {
        // The recorded key and URL already carry the prefix and path they were queued with.
        loader.path = "";
        loader.prefix = "";
        retrying.set(id, failure.rounds + 1);
        queueAgain(loader, failure);
      } else {
        loader.baseURL = load.baseURL;
        loader.path = load.path;
        loader.prefix = load.prefix;
        queueMulti({ ...load, rounds: load.rounds + 1 });
      }
    }
    loader.baseURL = baseURL;
    loader.path = path;
    loader.prefix = prefix;
    if (!loader.isLoading()) {
      loader.start();
    }
  };

  const onAdd = (_key: string, _type: string, _loader: unknown, file: Loader.File) => {
    applyTimeout(file);
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
    run = { done: 0, share: createFileShare(), total: loader.list.size };
    if (marked !== undefined) {
      const label = marked;
      marked = undefined;
      measure(label);
    }
  };
  const onLoad = (file: Loader.File) => {
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
    if (load.rounds >= RETRY_ROUNDS_MS.length) {
      entry.verdict = ` in retry round ${load.rounds}; giving up`;
    } else {
      entry.verdict = "; retrying later";
      const failure = {
        config: load.args,
        key: multi.key,
        rounds: load.rounds,
        type: load.method,
        url: String(file.url),
      };
      recorded.set(fileId(load.method, multi.key), { failure, load });
    }
    return entry.verdict;
  };
  const singleVerdict = (file: Loader.File) => {
    const id = fileId(file.type, file.key);
    const rounds = retrying.get(id) ?? 0;
    retrying.delete(id);
    const type = retryableType(file);
    if (type === undefined) {
      return "; not retried";
    }
    if (rounds >= RETRY_ROUNDS_MS.length) {
      return ` in retry round ${rounds}; giving up`;
    }
    const failure = { config: file.config, key: file.key, rounds, type, url: String(file.url) };
    recorded.set(id, { failure });
    return "; retrying later";
  };
  const onError = (file: Loader.File) => {
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
    run = undefined;
    if (measured !== undefined) {
      measured.handle.progress(1);
      measured.handle.finish();
      measured = undefined;
    }
    if (recorded.size > 0 && !roundPending) {
      const fewest = Math.min(...[...recorded.values()].map(({ failure }) => failure.rounds));
      roundPending = true;
      round = timer.setTimeout(runRound, RETRY_ROUNDS_MS[fewest] ?? 0);
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
    measured?.handle.finish();
    measured = undefined;
    marked = undefined;
    run = undefined;
    queuing = undefined;
    multiLoads = new WeakMap();
    recorded.clear();
    retrying.clear();
  };
  scene.events.once(Scenes.Events.SHUTDOWN, dispose);
  scene.events.once(Scenes.Events.DESTROY, dispose);

  return {
    dispose,
    failures: () => [...recorded.values()].map(({ failure }) => failure),
    waitFor(label) {
      if (measured !== undefined) {
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
