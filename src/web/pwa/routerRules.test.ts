import { describe, expect, it } from "vitest";

import { pinRecordPath } from "./buildContract.ts";
import {
  intervalElapsed,
  PIN_PRUNE_MS,
  pinnedClient,
  routerBuild,
  routesRequest,
  settledPins,
} from "./routerRules.ts";

const ORIGIN = "https://game.example";

describe("routerBuild", () => {
  const manifest = {
    boot: [],
    buildId: "b1",
    files: [{ byteSize: 3, sha256: "a".repeat(64), url: "/a.js" }],
    schema: 1,
    sounds: {},
    version: "v1",
  };

  it("indexes a saved manifest's files by URL", () => {
    const build = routerBuild("v1", manifest);
    expect(build?.version).toBe("v1");
    expect([...(build?.files.keys() ?? [])]).toEqual(["/a.js"]);
    expect(build?.families.size).toBe(0);
  });

  it("rejects another version's manifest and an invalid one", () => {
    expect(routerBuild("v2", manifest)).toBeUndefined();
    expect(routerBuild("v1", { ...manifest, files: "none" })).toBeUndefined();
    expect(routerBuild("v1", undefined)).toBeUndefined();
  });
});

describe("routesRequest", () => {
  const request = (origin: string, method = "GET", cache = "default") => ({
    cache,
    method,
    origin,
  });

  it("answers same-origin GETs other than no-store ones", () => {
    expect(routesRequest(ORIGIN, request(ORIGIN))).toBe(true);
    expect(routesRequest(ORIGIN, request(ORIGIN, "GET", "no-cache"))).toBe(true);
  });

  it("leaves other methods, no-store requests and other origins to the network", () => {
    expect(routesRequest(ORIGIN, request(ORIGIN, "POST"))).toBe(false);
    expect(routesRequest(ORIGIN, request(ORIGIN, "GET", "no-store"))).toBe(false);
    expect(routesRequest(ORIGIN, request("https://cdn.example"))).toBe(false);
  });
});

it("lets a periodic task run once its interval has passed", () => {
  expect(intervalElapsed(10, undefined, PIN_PRUNE_MS)).toBe(true);
  expect(intervalElapsed(PIN_PRUNE_MS - 1, 0, PIN_PRUNE_MS)).toBe(false);
  expect(intervalElapsed(PIN_PRUNE_MS, 0, PIN_PRUNE_MS)).toBe(true);
});

it("reads the client of a pin record and nothing else", () => {
  expect(pinnedClient(pinRecordPath("a/b c"))).toBe("a/b c");
  expect(pinnedClient("/.game-kit/records/active")).toBeUndefined();
});

it("settles pins written at least PIN_PRUNE_MS ago", () => {
  const pinnedAt = new Map([
    ["old", 0],
    ["edge", 1],
    ["new", 2],
  ]);
  expect(settledPins(PIN_PRUNE_MS + 1, pinnedAt)).toEqual(["old", "edge"]);
});
