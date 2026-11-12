import { Loader, type Scene, Scenes, type Types } from "phaser";

import type { Timer } from "../../clock/timer.ts";
import type { ProgressHandle } from "../../progressState.ts";
import { createFileShare } from "../fileShare.ts";
import { RETRY_ROUNDS_MS } from "../loaderConfig.ts";

// The file types a retry round can queue again, by their loader method.
export type RetryableType = "image" | "json" | "spritesheet" | "svg";

// A file whose last load failed, waiting for its next retry round. url is the file's URL as the
// loader resolved it against its path, and config its type's options: a JSON file's data key,
// an SVG's size or a sprite sheet's frames. rounds counts the retry rounds already run for it.
export interface LoadFailure {
  readonly config: unknown;
  readonly key: string;
  readonly rounds: number;
  readonly type: RetryableType;
  readonly url: string;
}

export interface LoaderWatch<Label extends string> {
  // Clears the scene's loader's listeners, cancels any retry round and finishes a measured run.
  dispose(): void;
  // The failed files waiting for their next retry round, oldest first.
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
// - Each run's measured share is createFileShare's: settled files, loaded or failed, out of the
//   run's total, never moving backward when the run queues more files. Only a run that waitFor
//   marked reports it, to a handle from progress begun as the run starts (or when waitFor joins
//   it), and finishes that handle at 1 as the run completes, an empty run at once. Every other
//   run, such as on-demand art and the retry rounds, is silent.
// - Each file that fails after the loader's own retries is logged once with console.warn and
//   recorded. When a run completes with recorded files and no round is pending, a retry round is
//   scheduled on timer RETRY_ROUNDS_MS after it, by the fewest rounds any recorded file has had.
//   The round queues every recorded file again by its type's loader method and starts the loader
//   if it is idle; a busy loader takes them into its run, and a run marked by waitFor is measured
//   whoever starts it. A file that fails again is recorded again, until it has failed its last
//   round and is logged as given up. A file of any other type, or part of a multi-file or linked
//   load, is logged as not retried.
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
  const recorded = new Map<string, LoadFailure>();
  // Files a round queued again, by id, with the rounds run for them.
  const retrying = new Map<string, number>();
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

  const runRound = () => {
    roundPending = false;
    const files = [...recorded.entries()];
    recorded.clear();
    const { path, prefix } = loader;
    // The recorded key and URL already carry the prefix and path they were queued with.
    loader.path = "";
    loader.prefix = "";
    for (const [id, failure] of files) {
      retrying.set(id, failure.rounds + 1);
      queueAgain(loader, failure);
    }
    loader.path = path;
    loader.prefix = prefix;
    if (!loader.isLoading()) {
      loader.start();
    }
  };

  const onAdd = (_key: string, _type: string, _loader: unknown, file: Loader.File) => {
    applyTimeout(file);
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
  const onError = (file: Loader.File) => {
    if (run !== undefined) {
      run.done += 1;
      report();
    }
    const id = fileId(file.type, file.key);
    const rounds = retrying.get(id) ?? 0;
    retrying.delete(id);
    const attempts = Math.max(1, 1 + loader.maxRetries - file.retryAttempts);
    const plural = attempts === 1 ? "" : "s";
    const failed = `Loading ${String(file.url)} failed after ${attempts} attempt${plural}`;
    const type = retryableType(file);
    if (type === undefined) {
      console.warn(`${failed}; not retried`);
    } else if (rounds >= RETRY_ROUNDS_MS.length) {
      console.warn(`${failed} in retry round ${rounds}; giving up`);
    } else {
      console.warn(`${failed}; retrying later`);
      const { config, key } = file;
      recorded.set(id, { config, key, rounds, type, url: String(file.url) });
    }
  };
  const onComplete = () => {
    run = undefined;
    if (measured !== undefined) {
      measured.handle.progress(1);
      measured.handle.finish();
      measured = undefined;
    }
    if (recorded.size > 0 && !roundPending) {
      const fewest = Math.min(...[...recorded.values()].map((failure) => failure.rounds));
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
    recorded.clear();
    retrying.clear();
  };
  scene.events.once(Scenes.Events.SHUTDOWN, dispose);
  scene.events.once(Scenes.Events.DESTROY, dispose);

  return {
    dispose,
    failures: () => [...recorded.values()],
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
