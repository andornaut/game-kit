// The fixture game: one loader through createLaunch, a boot that reads the manifest's boot files,
// a tick counter that stands for play, and a game-drawn Update now prompt that pauses it. The
// runner reads and drives window.e2e.
import { BUILD_POINTER_URL, type UpdateOffer } from "../../../../src/web/pwa/buildContract.ts";
import {
  createLaunch,
  prepareBrowserLaunch,
  type UpdateProgress,
} from "../../../../src/web/pwa/dom/launch.ts";
import { POLICY, SAVE_MS } from "../policy.ts";

declare const __VARIANT__: string;

export const SAVE_KEY = "e2e-save";

export interface E2eState {
  // The build this document's code is from.
  readonly variant: string;
  readonly timeOrigin: number;
  phase: "launching" | "booting" | "playing" | "reloading" | "unsupported";
  // The variant the boot index read through the router names.
  bootVariant?: string;
  // The variant of the game code imported after boot.
  gameVariant?: string;
  bootFiles: number;
  progress?: { phase: string; value: number; receivedBytes: number; totalBytes: number };
  progressStopped?: true;
  failures: string[];
  // Each onNetworkPlay reason.
  networkPlay: string[];
  updateReady: string[];
  // Each distinct update phase in order, as "phase" or "phase:version".
  updateStates: string[];
  paused: boolean;
  ticks: number;
  updateNowAt?: number;
  pointerAt?: number;
  offerAt?: number;
  playingAt?: number;
  updateProgress: UpdateProgress[];
  updateFrames: { preparing?: number; transferring?: number };
  appliedAt?: number;
  // The save the previous document wrote before Update now switched builds.
  lastSave?: { at: number; appliedAt?: number; variant: string };
  errors: string[];
}

declare global {
  interface Window {
    e2e: E2eState;
  }
}

function readSave(): E2eState["lastSave"] {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text === null ? undefined : (JSON.parse(text) as E2eState["lastSave"]);
  } catch {
    return undefined;
  }
}

const state: E2eState = {
  bootFiles: 0,
  errors: [],
  failures: [],
  networkPlay: [],
  paused: false,
  phase: "launching",
  ticks: 0,
  timeOrigin: performance.timeOrigin,
  updateFrames: {},
  updateProgress: [],
  updateReady: [],
  updateStates: [],
  variant: __VARIANT__,
};
window.e2e = state;

setInterval(() => {
  if (state.phase === "playing" && !state.paused) {
    state.ticks += 1;
  }
}, 50);

const prompt = document.getElementById("prompt") as HTMLElement;
let offer: UpdateOffer | undefined;

const save = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, SAVE_MS);
  });
  localStorage.setItem(
    SAVE_KEY,
    JSON.stringify({ appliedAt: state.updateNowAt, at: Date.now(), variant: state.variant }),
  );
};

document.getElementById("update-now")?.addEventListener("click", () => {
  if (offer === undefined) {
    return;
  }
  state.updateNowAt = Date.now();
  offer.updateNow(save).catch((error: unknown) => state.errors.push(String(error)));
});

document.getElementById("later")?.addEventListener("click", () => {
  offer?.dismiss();
  offer = undefined;
  prompt.hidden = true;
  state.paused = false;
});

const preparation = prepareBrowserLaunch(
  {
    onUnsupported: () => {
      state.progressStopped = true;
    },
    parent: document.body,
  },
  POLICY,
);
if (preparation.kind === "unsupported") {
  state.phase = "unsupported";
} else {
  const lastSave = readSave();
  if (lastSave !== undefined) {
    state.lastSave = lastSave;
  }
  const meter = document.createElement("progress");
  meter.hidden = true;
  document.body.append(meter);
  let displayed: UpdateProgress["phase"] | undefined;
  const reportUpdate = (next: UpdateProgress) => {
    state.updateProgress.push(next);
    if (next.phase === "applied") {
      state.appliedAt = performance.timeOrigin + performance.now();
    }
    const phase = next.phase;
    displayed = phase;
    meter.hidden =
      phase !== "preparing" &&
      phase !== "transferring" &&
      phase !== "verifying" &&
      phase !== "applying" &&
      phase !== "booting";
    if (phase === "transferring") {
      meter.max = next.totalBytes;
      meter.value = next.receivedBytes;
    } else if (phase === "booting" && next.counts !== undefined) {
      meter.max = next.counts.total;
      meter.value = next.counts.done;
    } else {
      meter.removeAttribute("value");
    }
    if (phase === "preparing" || phase === "transferring") {
      requestAnimationFrame((at) => {
        if (displayed === phase) {
          state.updateFrames[phase] ??= performance.timeOrigin + at;
        }
      });
    }
  };
  const context = preparation.context;
  const launch = createLaunch(
    {
      ...context,
      page: {
        ...context.page,
        fetch(url, init) {
          if (url === BUILD_POINTER_URL) {
            state.pointerAt ??= performance.timeOrigin + performance.now();
          }
          return context.page.fetch(url, init);
        },
      },
    },
    {
      onFailure: (failure) => {
        state.failures.push(failure.reason);
      },
      onNetworkPlay: (notice) => {
        state.networkPlay.push(notice.reason);
      },
      onProgress: ({ phase, receivedBytes, totalBytes, value }) => {
        state.progress = { phase, receivedBytes, totalBytes, value };
      },
      onUpdateProgress: reportUpdate,
      onUpdateReady: (next) => {
        state.offerAt = performance.timeOrigin + performance.now();
        state.updateReady.push(next.version);
        offer = next;
        state.paused = true;
        prompt.hidden = false;
      },
      onUpdateState: (next) => {
        const label = next.phase === "idle" ? "idle" : `${next.phase}:${next.version}`;
        if (state.updateStates.at(-1) !== label) {
          state.updateStates.push(label);
        }
      },
      serviceWorkerUrl: "/sw.js",
      // A game chooses with canPlayType; the fixture plays ogg, so the runner can predict requests.
      soundFormat: "ogg",
    },
  );

  const boot = async () => {
    state.phase = "booting";
    const index = (await (await fetch("/data/index.json")).json()) as {
      files: string[];
      variant: string;
    };
    state.bootVariant = index.variant;
    let done = 1;
    launch.bootProgress(done, index.files.length + 1);
    await Promise.all(
      index.files.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Boot file ${url}: ${response.status}`);
        }
        await response.arrayBuffer();
        done += 1;
        launch.bootProgress(done, index.files.length + 1);
      }),
    );
    state.bootFiles = done;
    state.gameVariant = (await import("./game.ts")).GAME_VARIANT;
    state.phase = "playing";
    state.playingAt = performance.timeOrigin + performance.now();
  };

  launch
    .run()
    .then(async (result) => {
      if (result === "play") {
        await boot();
      } else {
        state.phase = "reloading";
      }
    })
    .catch((error: unknown) => state.errors.push(String(error)));
}
