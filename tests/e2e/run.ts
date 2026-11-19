// The browser install and update check (docs/install-and-update.md, Tests). It builds the fixture
// game's deployments with the kit's precachePlugin, serves them with Cloudflare's HTTP/3 headers,
// throttles every page and service worker to a slow mobile link and every page to a 4x slower CPU
// over CDP, and drives Chromium through a first install, offline play and three updates. Runs
// only inside the Playwright container that `npm run test:e2e` starts. --long uses a fixture
// whose first install takes over five minutes.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright-core";

import {
  ACTIVE_RECORD_PATH,
  recordsCacheName,
  STAGED_RECORD_PATH,
} from "../../src/web/pwa/buildContract.ts";
import { buildDeployment, type Deployment, type FixtureSize, VARIANTS } from "./build.ts";
import { connectBrowserNetwork, type NetworkConditions } from "./cdp.ts";
import type { E2eState } from "./fixture/play/main.ts";
import { POLICY } from "./fixture/policy.ts";
import { type RequestRecord, startServer } from "./server.ts";

const LONG = process.argv.includes("--long");
const SIZE: FixtureSize = LONG
  ? { fileBytes: 10_000, files: 4500 }
  : { fileBytes: 4000, files: 400 };
// About 1.6 Mbit/s with 300 ms latency: a slow mobile link.
const THROTTLE: NetworkConditions = {
  downloadThroughput: 200_000,
  latency: 300,
  offline: false,
  uploadThroughput: 100_000,
};
// A slow mobile CPU, as a multiple of the container's.
const CPU_SLOWDOWN = 4;
const SINGLE_EVENT_LIMIT_MS = 300_000;
const CDP_PORT = 9333;
// The fixture's save duration (fixture/play/main.ts SAVE_MS).
const SAVE_MS = 1500;
const BUILD_CACHE_PREFIX = `${POLICY.cacheNamePrefix}build-`;

if (!existsSync("/.dockerenv")) {
  console.error("Run this through `npm run test:e2e`, which starts the Playwright container.");
  process.exit(2);
}

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ detail, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  return ok;
};
class Abort extends Error {}
const ensure = (name: string, ok: boolean, detail = "") => {
  if (!check(name, ok, detail)) {
    throw new Abort(name);
  }
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Evaluates in the page, retrying while a navigation replaces its document.
async function evaluate<T, A>(page: Page, fn: (arg: A) => T | Promise<T>, arg: A): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Each attempt waits for the one before it.
      // eslint-disable-next-line no-await-in-loop
      return await page.evaluate(fn as (value: unknown) => T | Promise<T>, arg as unknown);
    } catch (error) {
      if (attempt >= 40) {
        throw error;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(250);
    }
  }
}

const state = (page: Page) =>
  evaluate(page, () => (window.e2e === undefined ? undefined : { ...window.e2e }), undefined);

async function waitFor(
  page: Page,
  label: string,
  timeoutMs: number,
  predicate: (value: E2eState) => boolean,
): Promise<E2eState> {
  const deadline = Date.now() + timeoutMs;
  let last: E2eState | undefined;
  while (Date.now() < deadline) {
    // Polls in turn.
    // eslint-disable-next-line no-await-in-loop
    last = await state(page).catch(() => undefined);
    if (last !== undefined && predicate(last)) {
      return last;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  throw new Abort(
    `Timed out after ${seconds(timeoutMs)} waiting for ${label}: ${JSON.stringify(last)}`,
  );
}

const storedPaths = async (page: Page): Promise<Set<string>> =>
  new Set(
    await evaluate(
      page,
      async (prefix) => {
        const paths: string[] = [];
        for (const name of await caches.keys()) {
          if (name.startsWith(prefix)) {
            // Caches are read in turn.
            // eslint-disable-next-line no-await-in-loop
            const keys = await (await caches.open(name)).keys();
            paths.push(...keys.map((request) => new URL(request.url).pathname));
          }
        }
        return paths;
      },
      BUILD_CACHE_PREFIX,
    ),
  );

async function waitStored(page: Page, count: number, timeoutMs: number): Promise<Set<string>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const paths = await storedPaths(page).catch(() => new Set<string>());
    if (paths.size >= count) {
      return paths;
    }
    // eslint-disable-next-line no-await-in-loop
    const current = await state(page).catch(() => undefined);
    if (current !== undefined && (current.failures.length > 0 || current.phase === "playing")) {
      throw new Abort(
        `Install ended before ${count} files were stored: ${JSON.stringify(current)}`,
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  throw new Abort(`Timed out waiting for ${count} stored files`);
}

const records = (page: Page) =>
  evaluate(
    page,
    async ({ active, name, staged }) => {
      const cache = await caches.open(name);
      const read = async (path: string) =>
        ((await (await cache.match(path))?.json()) as { version?: string } | undefined)?.version;
      return { active: await read(active), staged: await read(staged) };
    },
    { active: ACTIVE_RECORD_PATH, name: recordsCacheName(POLICY), staged: STAGED_RECORD_PATH },
  );

// Ticks advance while the fixture plays and stop while its prompt pauses it.
async function ticking(page: Page): Promise<boolean> {
  const before = (await state(page))?.ticks ?? 0;
  await sleep(1000);
  return ((await state(page))?.ticks ?? 0) > before;
}

// Runs every step and returns how many checks failed.
async function main(): Promise<number> {
  const started = Date.now();
  const outRoot = join(process.env.TMPDIR ?? "/scratch", "e2e");
  mkdirSync(outRoot, { recursive: true });
  const deployments = {} as Record<(typeof VARIANTS)[number], Deployment>;
  for (const variant of VARIANTS) {
    // Builds run in turn; each is a whole Vite build.
    // eslint-disable-next-line no-await-in-loop
    deployments[variant] = await buildDeployment({ outRoot, size: SIZE }, variant);
  }
  const { a, a2, b, c, d } = deployments;
  const buildMs = Date.now() - started;
  const fileCount = a.manifest.files.length;
  const fileBytes = a.manifest.files.reduce((sum, file) => sum + file.byteSize, 0);
  console.log(
    `Built ${VARIANTS.length} deployments of ${fileCount} files ` +
      `(${(fileBytes / 1e6).toFixed(1)} MB) in ${seconds(buildMs)}`,
  );

  const server = await startServer();
  server.deploy(a.directory);
  // Build files and manifests: what a launch from stored builds never requests.
  const buildPaths = new Set(
    Object.values(deployments).flatMap(({ manifest }) => manifest.files.map((file) => file.url)),
  );
  const isBuildRequest = (path: string) =>
    buildPaths.has(path) || path.startsWith("/.game-kit/manifest-");
  const since = (mark: number) => server.log.slice(mark);
  const buildRequests = (log: readonly RequestRecord[]) =>
    log.filter((r) => isBuildRequest(r.path));
  const others = (log: readonly RequestRecord[]) =>
    [...new Set(log.filter((r) => !isBuildRequest(r.path)).map((r) => r.path))].join(", ") ||
    "none";
  const repeatedAfter = (mark: number, stored: Set<string>) =>
    since(mark).filter((r) => stored.has(r.path) && r.path !== "/play/");

  const profile = join(outRoot, "profile");
  const context = await chromium.launchPersistentContext(profile, {
    args: [`--remote-debugging-port=${CDP_PORT}`, "--disable-dev-shm-usage"],
    channel: "chromium",
    headless: true,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[page ${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => console.log(`[page error] ${error.message}`));
  const network = await connectBrowserNetwork(
    { cpuSlowdown: CPU_SLOWDOWN, port: CDP_PORT },
    THROTTLE,
  );
  const url = `${server.origin}/play/`;

  try {
    // First install: a reload, a worker stop and a redeploy, each at a stored-file threshold.
    const installStarted = Date.now();
    await page.goto(url);
    const atReload = await waitStored(page, Math.floor(fileCount * 0.25), 30 * 60_000);
    const reloadMark = server.log.length;
    await page.reload();
    const atStop = await waitStored(page, Math.floor(fileCount * 0.5), 30 * 60_000);
    const stopMark = server.log.length;
    await network.stopServiceWorkers();
    const atDeploy = await waitStored(page, Math.floor(fileCount * 0.7), 30 * 60_000);
    const deployMark = server.log.length;
    server.deploy(a2.directory);
    const installed = await waitFor(
      page,
      "the first install",
      30 * 60_000,
      (s) => s.phase === "playing" || s.failures.length > 0,
    );
    const installMs = Date.now() - installStarted;
    const installLog = buildRequests(server.log);
    const sizes = new Map(
      [...a.manifest.files, ...a2.manifest.files].map((file) => [file.url, file.byteSize]),
    );
    const fetchedBytes = installLog.reduce(
      (sum, r) => sum + (r.status === 200 ? (sizes.get(r.path) ?? 0) : 0),
      0,
    );
    const repeats = installLog.length - new Set(installLog.map((r) => r.path)).size;
    console.log(
      `First install: ${seconds(installMs)}, ${installLog.length} build requests, ` +
        `${repeats} repeated, ` +
        `${(fetchedBytes / 1e6).toFixed(1)} MB at ` +
        `${((fetchedBytes * 8) / (installMs / 1000) / 1e6).toFixed(2)} Mbit/s, ` +
        `throttled targets ${JSON.stringify(network.throttled())}`,
    );
    ensure(
      "first install completes with no Loading failed",
      installed.phase === "playing" &&
        installed.failures.length === 0 &&
        installed.networkPlay.length === 0,
      `phase ${installed.phase}, failures [${installed.failures.join(", ")}], ` +
        `network play [${installed.networkPlay.join(", ")}], ${seconds(installMs)}`,
    );
    if (LONG) {
      check(
        "first install runs past the 5 minute single-event limit",
        installMs > SINGLE_EVENT_LIMIT_MS,
        seconds(installMs),
      );
    }
    const reloadRepeats = repeatedAfter(reloadMark, atReload);
    check(
      "a reload mid-install resumes with no repeat requests for stored files",
      reloadRepeats.length === 0,
      `${atReload.size} stored at reload, ${reloadRepeats.length} requested again`,
    );
    const stopRepeats = repeatedAfter(stopMark, atStop);
    check(
      "a service worker stop mid-install resumes with no repeat requests for stored files",
      stopRepeats.length === 0,
      `${atStop.size} stored at stop, ${stopRepeats.length} requested again`,
    );
    const installedRecords = await records(page);
    const deployRepeats = repeatedAfter(deployMark, atDeploy);
    const a2Only = a2.manifest.files.filter(
      (file) => !a.manifest.files.some((old) => old.sha256 === file.sha256),
    );
    check(
      "a redeploy mid-install restarts on the new build and reuses stored files",
      installedRecords.active === a2.manifest.version && deployRepeats.length === 0,
      `active ${installedRecords.active} (a2 ${a2.manifest.version}), ${atDeploy.size} stored at ` +
        `redeploy, ${deployRepeats.length} requested again, ${a2Only.length} new files`,
    );

    // Offline play from the stored build.
    await network.setConditions({ ...THROTTLE, offline: true });
    server.refuse(true);
    const offlineMark = server.log.length;
    await page.reload();
    const offline = await waitFor(page, "offline play", 60_000, (s) => s.phase === "playing");
    check(
      "play works offline afterwards",
      offline.bootVariant === "a" &&
        offline.failures.length === 0 &&
        since(offlineMark).length === 0 &&
        (await ticking(page)),
      `boot index ${offline.bootVariant}, ${offline.bootFiles} boot files, ` +
        `${since(offlineMark).length} requests reached the server`,
    );
    server.refuse(false);
    await network.setConditions(THROTTLE);

    // Update to b: staged in the background, offered mid-session, dismissed.
    server.deploy(b.directory);
    const reused = new Set(a2.manifest.files.map((file) => file.sha256));
    const delta = new Set(b.manifest.files.filter((f) => !reused.has(f.sha256)).map((f) => f.url));
    const updateMark = server.log.length;
    await page.reload();
    const offered = await waitFor(
      page,
      "update b to stage",
      10 * 60_000,
      (s) => s.updateReady.length > 0 || s.updateStates.some((label) => label.startsWith("failed")),
    );
    const updateFiles = buildRequests(since(updateMark)).filter(
      (r) => !r.path.startsWith("/.game-kit/"),
    );
    const updatePaths = new Set(updateFiles.map((r) => r.path));
    check(
      "an update fetches only the changed files",
      offered.updateReady.length > 0 &&
        updateFiles.length === delta.size &&
        updatePaths.size === delta.size &&
        [...delta].every((path) => updatePaths.has(path)),
      `${delta.size} changed of ${b.manifest.files.length}, ${updateFiles.length} fetched: ` +
        `${[...updatePaths].filter((p) => !delta.has(p)).join(", ") || "none unexpected"}; ` +
        `states ${offered.updateStates.join(" > ")}`,
    );
    ensure("onUpdateReady fires for the staged build", offered.updateReady.length > 0);
    const pausedTicks = !(await ticking(page));
    const promptShown = await page.isVisible("#prompt");
    await page.click("#later");
    const resumed = await ticking(page);
    const served = await evaluate(
      page,
      async () => ((await (await fetch("/data/index.json")).json()) as { variant: string }).variant,
      undefined,
    );
    const dismissedRecords = await records(page);
    await sleep(2000);
    const afterDismiss = await state(page);
    check(
      "staging mid-session fires onUpdateReady once, the prompt pauses play and dismiss keeps the active build",
      offered.updateReady.length === 1 &&
        offered.updateReady[0] === b.manifest.version &&
        promptShown &&
        pausedTicks &&
        resumed &&
        served === "a" &&
        dismissedRecords.active === a2.manifest.version &&
        dismissedRecords.staged === b.manifest.version &&
        afterDismiss?.updateReady.length === 1,
      `offers ${afterDismiss?.updateReady.length}, paused ${pausedTicks}, resumed ${resumed}, ` +
        `serving ${served}, records ${JSON.stringify(dismissedRecords)}`,
    );

    // The next launch promotes b silently.
    const launchMark = server.log.length;
    await page.reload();
    const launched = await waitFor(
      page,
      "the promoted launch",
      60_000,
      (s) => s.phase === "playing",
    );
    await sleep(1500);
    const launchRecords = await records(page);
    const launchRequests = buildRequests(since(launchMark));
    check(
      "the next launch promotes silently with zero requests",
      launched.variant === "b" &&
        launched.bootVariant === "b" &&
        launched.updateReady.length === 0 &&
        launchRequests.length === 0 &&
        launchRecords.active === b.manifest.version &&
        launchRecords.staged === undefined,
      `running ${launched.variant}, ${launchRequests.length} build requests, ` +
        `other requests: ${others(since(launchMark))}`,
    );

    // Update to c through Update now.
    server.deploy(c.directory);
    await page.reload();
    await waitFor(page, "update c to stage", 10 * 60_000, (s) => s.updateReady.length > 0);
    const switchMark = server.log.length;
    const clickedAt = Date.now();
    await page.click("#update-now");
    const switched = await waitFor(
      page,
      "Update now",
      60_000,
      (s) => s.variant === "c" && s.phase === "playing",
    );
    await sleep(1500);
    const switchRequests = buildRequests(since(switchMark));
    const saved = switched.lastSave;
    const savedAfter = (await records(page)).active;
    check(
      "updateNow awaits save and then switches with zero requests",
      saved !== undefined &&
        saved.variant === "b" &&
        saved.at - clickedAt >= SAVE_MS - 100 &&
        saved.at <= switched.timeOrigin &&
        savedAfter === c.manifest.version &&
        switchRequests.length === 0,
      `saved ${JSON.stringify(saved)}, new document at ${switched.timeOrigin}, ` +
        `${switchRequests.length} build requests, other requests: ${others(since(switchMark))}`,
    );

    // Update to d, whose download fails.
    const reusedC = new Set(c.manifest.files.map((file) => file.sha256));
    const broken = d.manifest.files.find(
      (file) => !reusedC.has(file.sha256) && file.url.startsWith("/assets/f/"),
    );
    ensure("update d changes an asset", broken !== undefined);
    server.failing.add(broken!.url);
    server.deploy(d.directory);
    await page.reload();
    const failed = await waitFor(
      page,
      "update d to fail",
      5 * 60_000,
      (s) => s.updateStates.includes(`failed:${d.manifest.version}`) || s.updateReady.length > 0,
    );
    const failedTicks = await ticking(page);
    const afterFailure = await state(page);
    check(
      "a failed background update never calls onFailure",
      failed.updateStates.includes(`failed:${d.manifest.version}`) &&
        afterFailure?.failures.length === 0 &&
        afterFailure.updateReady.length === 0 &&
        afterFailure.phase === "playing" &&
        !afterFailure.paused &&
        failedTicks &&
        (await records(page)).active === c.manifest.version,
      `states ${failed.updateStates.join(" > ")}, ` +
        `failures [${afterFailure?.failures.join(", ")}], ticking ${failedTicks}`,
    );
  } finally {
    network.close();
    await context.close();
    await server.close();
  }
  const failedCount = results.filter((r) => !r.ok).length;
  console.log(
    `e2e ${LONG ? "long" : "short"}: ${results.length - failedCount} passed, ${failedCount} failed in ` +
      `${seconds(Date.now() - started)} (builds ${seconds(buildMs)})`,
  );
  return failedCount;
}

main().then(
  (failedCount) => {
    process.exitCode = failedCount === 0 ? 0 : 1;
  },
  (error: unknown) => {
    if (!(error instanceof Abort)) {
      console.error(error);
    } else {
      console.error(`Stopped: ${error.message}`);
    }
    const failedCount = results.filter((r) => !r.ok).length;
    console.log(
      `e2e ${LONG ? "long" : "short"}: stopped after ${results.length - failedCount} passed, ${failedCount} failed`,
    );
    process.exitCode = 1;
  },
);
