// The fixture game: one loader through createLaunch, a boot that reads the manifest's boot files,
// a tick counter that stands for play, and a game-drawn Update now prompt that pauses it. The
// runner reads and drives window.e2e.
import type { UpdateOffer } from "../../../../src/web/pwa/buildContract.ts";
import { browserLaunchContext, createLaunch } from "../../../../src/web/pwa/dom/launch.ts";
import { POLICY } from "../policy.ts";

declare const __VARIANT__: string;

export const SAVE_KEY = "e2e-save";
// How long the fixture's save takes, so the runner can see updateNow wait for it.
export const SAVE_MS = 1500;

export interface E2eState {
  // The build this document's code is from.
  readonly variant: string;
  readonly timeOrigin: number;
  phase: "launching" | "booting" | "playing" | "reloading" | "unsupported";
  // The variant the boot index read through the router names.
  bootVariant?: string;
  bootFiles: number;
  progress?: { phase: string; value: number; receivedBytes: number; totalBytes: number };
  failures: string[];
  // Each onNetworkPlay reason.
  networkPlay: string[];
  updateReady: string[];
  // Each distinct update phase in order, as "phase" or "phase:version".
  updateStates: string[];
  paused: boolean;
  ticks: number;
  updateNowAt?: number;
  // The save the previous document wrote before Update now switched builds.
  lastSave?: { at: number; variant: string };
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

const lastSave = readSave();
const state: E2eState = {
  bootFiles: 0,
  errors: [],
  failures: [],
  networkPlay: [],
  paused: false,
  phase: "launching",
  ticks: 0,
  timeOrigin: performance.timeOrigin,
  updateReady: [],
  updateStates: [],
  variant: __VARIANT__,
  ...(lastSave === undefined ? {} : { lastSave }),
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
  localStorage.setItem(SAVE_KEY, JSON.stringify({ at: Date.now(), variant: state.variant }));
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

const context = browserLaunchContext(POLICY);
if (context === undefined) {
  state.phase = "unsupported";
} else {
  const launch = createLaunch(context, {
    onFailure: (failure) => {
      state.failures.push(failure.reason);
    },
    onNetworkPlay: (notice) => {
      state.networkPlay.push(notice.reason);
    },
    onProgress: ({ phase, receivedBytes, totalBytes, value }) => {
      state.progress = { phase, receivedBytes, totalBytes, value };
    },
    onUpdateReady: (next) => {
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
  });

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
    state.phase = "playing";
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
