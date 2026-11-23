import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page, type Response } from "playwright-core";

import {
  ACTIVE_RECORD_PATH,
  BUILD_ARCHIVE_PART_BYTES,
  BUILD_HASH_HEADER,
  BUILD_POINTER_URL,
  buildArchivePartUrl,
  buildCacheName,
  recordsCacheName,
  STAGED_RECORD_PATH,
} from "../../src/web/pwa/buildContract.ts";
import { buildDeployment, type Deployment } from "./build.ts";
import type { E2eState } from "./fixture/play/main.ts";
import { POLICY, SAVE_MS } from "./fixture/policy.ts";
import { type FixtureServer, startServer } from "./server.ts";

const BODY_PATH = "/.game-kit/records/archive-body";
const ROUTER_PATH = "/sw.js";
const ARCHIVE_ROUTER_PROBE = "game-kit:archive-router:1";
const GROUP_ROUTER_PROBE = "game-kit:group-router:1";
const WAIT = 45_000;

declare global {
  interface Window {
    wholeBuildCacheWrites: string[];
  }
}

async function playing(page: Page, deployment: Deployment): Promise<E2eState> {
  await page.waitForFunction(
    (variant) => {
      const state = window.e2e;
      return (
        state?.variant === variant &&
        (state.phase === "playing" || state.errors.length > 0 || state.failures.length > 0)
      );
    },
    deployment.variant,
    { timeout: WAIT },
  );
  const state = await page.evaluate(() => window.e2e);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.failures, []);
  assert.deepEqual(state.networkPlay, []);
  assert.equal(state.phase, "playing");
  assert.equal(state.bootVariant, deployment.variant);
  assert.equal(state.gameVariant, deployment.variant);
  return state;
}

const records = (page: Page) =>
  page.evaluate(
    async ({ active, cacheName, staged }) => {
      const read = async (path: string) =>
        (
          (await (await caches.match(path, { cacheName }))?.json()) as
            { version: string } | undefined
        )?.version;
      return { active: await read(active), staged: await read(staged) };
    },
    { active: ACTIVE_RECORD_PATH, cacheName: recordsCacheName(POLICY), staged: STAGED_RECORD_PATH },
  );

const pinnedVariant = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch("/data/index.json", { cache: "reload" });
    if (!response.ok) {
      throw new Error(`Pinned document's data failed: ${response.status}`);
    }
    return ((await response.json()) as { variant: string }).variant;
  });

async function verifyStoredTransport(page: Page, deployment: Deployment): Promise<void> {
  const { archive, groups, version } = deployment.pointer;
  assert(archive ?? groups);
  const bodies = groups?.map((group) => ({
    byteSize: group.byteSize,
    path: buildArchivePartUrl(group, 0),
    sha256: group.sha256,
    stamped: group.sha256,
  })) ?? [
    {
      byteSize: archive!.byteSize,
      path: BODY_PATH,
      sha256: archive!.sha256,
      stamped: archive!.sha256,
    },
  ];
  const markerKind = groups === undefined ? "archive" : "group";
  const stored = await page.evaluate(
    async ({ cacheName, hashHeader, marker, paths, recordsName }) => {
      if (!(await caches.has(cacheName))) {
        throw new Error("Missing candidate cache");
      }
      const cache = await caches.open(cacheName);
      const storedBodies = await Promise.all(
        paths.map(async (path) => {
          const response = await cache.match(path);
          if (response === undefined) {
            throw new Error(`Missing verified archive body at ${path}`);
          }
          const bytes = await response.arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          return {
            byteSize: bytes.byteLength,
            path,
            sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
            stamped: response.headers.get(hashHeader),
          };
        }),
      );
      return {
        bodies: storedBodies,
        keys: (await cache.keys()).map((key) => new URL(key.url).pathname).sort(),
        marker: (await (await caches.match(marker, { cacheName: recordsName }))?.json()) as unknown,
      };
    },
    {
      cacheName: buildCacheName(POLICY, version),
      hashHeader: BUILD_HASH_HEADER,
      marker: `/.game-kit/${markerKind}-record-${encodeURIComponent(version)}.json`,
      paths: bodies.map(({ path }) => path),
      recordsName: recordsCacheName(POLICY),
    },
  );
  assert.deepEqual(stored.keys, bodies.map(({ path }) => path).sort());
  assert.deepEqual(stored.marker, deployment.pointer);
  assert.deepEqual(stored.bodies, bodies);
}

async function stage(
  context: {
    readonly page: Page;
    readonly server: FixtureServer;
    readonly requests: readonly string[];
    readonly offline: (offline: boolean) => Promise<void>;
  },
  active: Deployment,
  candidate: Deployment,
): Promise<E2eState> {
  const { offline, page, requests, server } = context;
  const before = await playing(page, active);
  const { archive, groups, version } = candidate.pointer;
  assert(archive ?? groups);
  const activeGroups = new Set(active.pointer.groups?.map(({ sha256 }) => sha256));
  const reused = groups?.filter(({ sha256 }) => activeGroups.has(sha256)) ?? [];
  const parts =
    groups === undefined
      ? Array.from({ length: Math.ceil(archive!.byteSize / BUILD_ARCHIVE_PART_BYTES) }, (_, i) =>
          buildArchivePartUrl(archive!, i),
        )
      : groups
          .filter(({ sha256 }) => !activeGroups.has(sha256))
          .map((group) => buildArchivePartUrl(group, 0));
  if (groups !== undefined && active.pointer.groups !== undefined) {
    assert(reused.length > 0 && parts.length > 0, "Fixture must reuse and change groups");
  }
  assert(
    candidate.manifest.files.some((file) =>
      active.manifest.files.some(({ sha256, url }) => url === file.url && sha256 === file.sha256),
    ),
    "Fixture must contain unchanged entries that a delta update could copy",
  );
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.waitForFunction(
    (router) => navigator.serviceWorker.controller?.scriptURL === router,
    server.origin + ROUTER_PATH,
    { timeout: WAIT },
  );
  const answersProbe = await page.evaluate(
    ({ probe, router }) =>
      new Promise<boolean>((resolve) => {
        const controller = navigator.serviceWorker.controller;
        if (controller?.scriptURL !== router || controller.state !== "activated") {
          resolve(false);
          return;
        }
        const { port1, port2 } = new MessageChannel();
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          port1.close();
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 5000);
        port1.onmessage = (event) => {
          finish(event.data === probe && navigator.serviceWorker.controller === controller);
        };
        controller.postMessage(probe, [port2]);
      }),
    {
      probe: groups === undefined ? ARCHIVE_ROUTER_PROBE : GROUP_ROUTER_PROBE,
      router: server.origin + ROUTER_PATH,
    },
  );
  assert(answersProbe, "Current controlling router must acknowledge the selected transport");
  const logStart = server.log.length;
  const requestsStart = requests.length;
  const writesStart = await page.evaluate(() => window.wholeBuildCacheWrites.length);
  server.deploy(candidate.directory);
  await offline(false);
  await page.waitForFunction(
    () =>
      window.e2e?.updateReady.length > 0 ||
      window.e2e?.updateStates.some((label) => label.startsWith("failed:")),
    undefined,
    { timeout: WAIT },
  );
  const offered = await playing(page, active);
  assert.equal(offered.timeOrigin, before.timeOrigin);
  assert.deepEqual(offered.updateReady, [version]);
  assert.equal(offered.updateStates.filter((label) => label === `ready:${version}`).length, 1);
  assert.equal(offered.paused, true);
  assert.equal(await page.locator("#prompt").isVisible(), true);
  assert.deepEqual(await records(page), { active: active.pointer.version, staged: version });
  await verifyStoredTransport(page, candidate);

  const network = server.log.slice(logStart);
  assert(network.some(({ path, status }) => path === BUILD_POINTER_URL && status === 200));
  const partRequests = network.filter(({ path }) => path.startsWith("/.game-kit/archive-"));
  assert.deepEqual(
    partRequests.map(({ path }) => path),
    parts,
  );
  assert(partRequests.every(({ status }) => status === 200));
  const filePaths = new Set(
    [active, candidate].flatMap(({ manifest }) => manifest.files.map(({ url }) => url)),
  );
  const paths = [...requests.slice(requestsStart), ...network.map(({ path }) => path)];
  assert(
    !paths.includes(candidate.pointer.manifest),
    "Legacy manifest requested for archive staging",
  );
  for (const group of reused) {
    assert(!paths.includes(buildArchivePartUrl(group, 0)), "Unchanged group requested again");
  }
  assert.deepEqual(
    paths.filter((path) => filePaths.has(path)),
    [],
    "Per-file request while staging",
  );
  const writes = await page.evaluate(
    (start) => window.wholeBuildCacheWrites.slice(start),
    writesStart,
  );
  assert.deepEqual(
    writes.filter((path) => filePaths.has(path)),
    [],
    "Per-file copy while staging",
  );
  assert.equal(await pinnedVariant(page), active.variant);
  console.log(
    `PASS ${active.variant} → ${candidate.variant} staged once via ${parts.length} archive part(s), ` +
      `${reused.length} group(s) reused`,
  );
  return offered;
}

async function offlineFiles(
  page: Page,
  navigation: Response,
  deployment: Deployment,
): Promise<void> {
  assert.equal(navigation.status(), 200);
  assert(navigation.fromServiceWorker());
  assert.match((await navigation.headerValue("content-type")) ?? "", /^text\/html\b/i);
  assert.equal(await navigation.headerValue("x-content-type-options"), "nosniff");
  const digest = createHash("sha256")
    .update(await navigation.body())
    .digest("hex");
  const files = new Map(deployment.manifest.files.map((file) => [file.url, file]));
  assert.equal(digest, files.get("/play/")?.sha256);

  const script = await page.locator('script[type="module"][src]').getAttribute("src");
  assert(script);
  const scriptPath = new URL(script, page.url()).pathname;
  const sound = Object.values(deployment.manifest.sounds)
    .flat()
    .find((path) => path.endsWith(".ogg"));
  assert(sound);
  const samples = await page.evaluate(
    async (urls) =>
      Promise.all(
        urls.map(async (url) => {
          // The archive router handles reload mode, which bypasses the browser HTTP cache.
          const response = await fetch(url, { cache: "reload" });
          const body = await response.arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
          return {
            contentType: response.headers.get("content-type") ?? "",
            nosniff: response.headers.get("x-content-type-options"),
            sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
            status: response.status,
            url,
          };
        }),
      ),
    [scriptPath, "/data/index.json", "/data/shared-a.json", sound],
  );
  for (const [index, sample] of samples.entries()) {
    const media = [
      /^text\/javascript\b/i,
      /^application\/json\b/i,
      /^application\/json\b/i,
      /^audio\/ogg\b/i,
    ];
    assert.equal(sample.status, 200, sample.url);
    assert.equal(sample.sha256, files.get(sample.url)?.sha256, sample.url);
    assert.equal(sample.nosniff, "nosniff", sample.url);
    assert.match(sample.contentType, media[index]!, sample.url);
  }
  console.log(`PASS ${deployment.variant} serves exact HTML, JS, JSON and Ogg bytes offline`);
}

export async function runWholeBuildAcceptance(mode: "grouped" | "whole-build"): Promise<number> {
  const outRoot = join(process.env.TMPDIR ?? "/scratch", `e2e-${mode}`);
  mkdirSync(outRoot, { recursive: true });
  const build = { outRoot, size: { fileBytes: 2000, files: 40 } };
  const archiveOnly = (url: string) => /^\/(?:assets\/[fs]\/|data\/)/.test(url);
  // Sound bodies and URLs stay fixed while the page, code and data change between deployments.
  const transport =
    mode === "grouped"
      ? {
          groupedFirstInstall: { archiveOnly },
          updateGroup: (url: string) => (url.startsWith("/assets/s/") ? "audio" : "game"),
        }
      : { wholeBuild: true as const };
  const baseline = await buildDeployment(
    mode === "grouped" ? { ...build, ...transport } : build,
    "a",
  );
  const accepted = await buildDeployment({ ...build, ...transport }, "b");
  const canceled = await buildDeployment({ ...build, ...transport }, "c");
  assert.equal(baseline.pointer.archive, undefined);
  assert.equal(baseline.pointer.groupedFirstInstall, mode === "grouped" ? true : undefined);
  if (mode === "grouped") {
    for (const { directory, manifest } of [baseline, accepted, canceled]) {
      const hidden = manifest.files.filter(({ url }) => archiveOnly(url));
      assert(hidden.length > 0);
      assert(hidden.every(({ url }) => !existsSync(join(directory, url))));
    }
  }

  const browser = await chromium.launch({ channel: "chromium", headless: true });
  try {
    const server = await startServer();
    try {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        const put = Cache.prototype.put;
        window.wholeBuildCacheWrites = [];
        Cache.prototype.put = function (request, response) {
          const url = request instanceof Request ? request.url : request;
          window.wholeBuildCacheWrites.push(new URL(url, location.origin).pathname);
          return put.call(this, request, response);
        };
      });
      const requests: string[] = [];
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin === server.origin) {
          requests.push(url.pathname);
        }
      });
      const page = await context.newPage();
      const offline = async (value: boolean) => {
        server.refuse(value);
        await context.setOffline(value);
      };
      const url = `${server.origin}/play/`;
      server.deploy(baseline.directory);
      await page.goto(url);
      await playing(page, baseline);
      assert.deepEqual(await records(page), {
        active: baseline.pointer.version,
        staged: undefined,
      });
      const legacyKeys = await page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname),
        buildCacheName(POLICY, baseline.pointer.version),
      );
      if (mode === "grouped") {
        await verifyStoredTransport(page, baseline);
        const partRequests = server.log.filter(({ path }) =>
          path.startsWith("/.game-kit/archive-"),
        );
        assert.deepEqual(
          partRequests.map(({ path }) => path),
          baseline.pointer.groups!.map((group) => buildArchivePartUrl(group, 0)),
        );
        assert(partRequests.every(({ status }) => status === 200));
        assert(!server.log.some(({ path }) => archiveOnly(path)));
        assert(!legacyKeys.some(archiveOnly));
      } else {
        assert(legacyKeys.includes("/play/") && legacyKeys.some((path) => path.endsWith(".ogg")));
      }
      assert(!legacyKeys.includes(BODY_PATH));
      await offline(true);
      const firstOffline = await page.reload();
      await playing(page, baseline);
      if (mode === "grouped") {
        assert(firstOffline);
        await offlineFiles(page, firstOffline, baseline);
        console.log("PASS cold install and offline reload use prebuilt archive-only members");
      }

      const lane = { offline, page, requests, server };
      const offered = await stage(lane, baseline, accepted);
      assert.equal(offered.lastSave, undefined);
      await offline(true);
      const navigation = page.waitForResponse(
        (response) => response.url() === url && response.request().isNavigationRequest(),
      );
      const clickedAt = Date.now();
      const [updatedPage] = await Promise.all([navigation, page.locator("#update-now").click()]);
      const switched = await playing(page, accepted);
      assert(switched.lastSave);
      assert.equal(switched.lastSave.variant, baseline.variant);
      assert(switched.lastSave.at >= clickedAt + SAVE_MS - 100);
      assert(
        switched.lastSave.at <= switched.timeOrigin && switched.timeOrigin > offered.timeOrigin,
      );
      assert.deepEqual(await records(page), {
        active: accepted.pointer.version,
        staged: undefined,
      });
      await offlineFiles(page, updatedPage, accepted);

      const again = await stage(lane, accepted, canceled);
      await page.locator("#later").click();
      const dismissed = await playing(page, accepted);
      assert.equal(dismissed.timeOrigin, again.timeOrigin);
      assert.equal(dismissed.paused, false);
      assert.deepEqual(dismissed.updateReady, [canceled.pointer.version]);
      assert.equal(await page.locator("#prompt").isVisible(), false);
      assert.deepEqual(await records(page), {
        active: accepted.pointer.version,
        staged: canceled.pointer.version,
      });
      await offline(true);
      // Keep the previous grouped document open while an unpinned navigation promotes the stage.
      const coldPage = mode === "grouped" ? await context.newPage() : page;
      const cold = mode === "grouped" ? await coldPage.goto(url) : await coldPage.reload();
      assert(cold);
      const promoted = await playing(coldPage, canceled);
      assert(promoted.timeOrigin > dismissed.timeOrigin);
      assert.deepEqual(promoted.lastSave, switched.lastSave);
      assert.deepEqual(promoted.updateReady, []);
      assert.deepEqual(await records(coldPage), {
        active: canceled.pointer.version,
        staged: undefined,
      });
      await offlineFiles(coldPage, cold, canceled);
      if (coldPage !== page) {
        assert.equal((await playing(page, accepted)).timeOrigin, dismissed.timeOrigin);
        assert.equal(await pinnedVariant(page), accepted.variant);
        console.log("PASS the older grouped document still serves its pinned data offline");
      }
      console.log(
        "PASS dismiss retains the running build and the next offline launch promotes the stage",
      );
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
  return 0;
}
