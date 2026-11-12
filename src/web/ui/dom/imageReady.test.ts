// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImageCache, PENDING_ATTRIBUTE, revealWhenDecoded } from "./imageReady.ts";

// Each decode waits until the test settles it by its image's src.
let decodes: Map<string, { fail: () => void; finish: () => void }>;
let requested: string[];

beforeEach(() => {
  decodes = new Map();
  requested = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (
    this: HTMLImageElement,
  ) {
    const url = this.getAttribute("src") ?? "";
    requested.push(url);
    return new Promise<void>((resolve, reject) => {
      decodes.set(url, { fail: () => reject(new Error(url)), finish: resolve });
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Whether promise has settled once every pending microtask has run.
const settled = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 0);
    }),
  ]);

const pending = (layer: Element) => layer.hasAttribute(PENDING_ATTRIBUTE);

describe("createImageCache", () => {
  it("requests and decodes each url once, however often it is retained or queried", () => {
    const cache = createImageCache(document);
    cache.retain(["a.png", "a.png", "b.png"]);
    cache.retain(["b.png"]);
    void cache.decoded(["b.png", "c.png", "a.png"]);
    expect(requested).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("settles decoded once every url has decoded or failed, and never rejects", async () => {
    const cache = createImageCache(document);
    cache.retain(["a.png", "b.png"]);
    const decoded = cache.decoded(["a.png", "b.png"]);
    decodes.get("a.png")!.finish();
    const afterOne = await settled(decoded);
    decodes.get("b.png")!.fail();
    expect([afterOne, await settled(decoded)]).toEqual([false, true]);
    await expect(decoded).resolves.toBeUndefined();
  });
});

describe("revealWhenDecoded", () => {
  it("holds the layer pending until every url settles, then shows it", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    const reveal = revealWhenDecoded(cache, ["a.png", "b.png"], layer);
    decodes.get("b.png")!.fail();
    await settled(reveal.revealed);
    const held = pending(layer);
    decodes.get("a.png")!.finish();
    expect([held, await reveal.revealed, pending(layer)]).toEqual([true, true, false]);
  });

  it("shows the layer at once on cancel and resolves false", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    const reveal = revealWhenDecoded(cache, ["a.png"], layer);
    reveal.cancel();
    const shown = !pending(layer);
    layer.setAttribute(PENDING_ATTRIBUTE, "");
    decodes.get("a.png")!.finish();
    expect([shown, await reveal.revealed]).toEqual([true, false]);
    // The cancelled reveal leaves the layer alone once its art decodes.
    await cache.decoded(["a.png"]);
    expect(pending(layer)).toBe(true);
  });

  it("holds the layer pending until a promised list resolves, then until its urls settle", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    let resolve: (urls: readonly string[]) => void = () => undefined;
    const urls = new Promise<readonly string[]>((settle) => {
      resolve = settle;
    });
    const reveal = revealWhenDecoded(cache, urls, layer);
    const beforeList = [pending(layer), await settled(reveal.revealed), requested.length];
    resolve(["a.png"]);
    await settled(reveal.revealed);
    const beforeDecode = [pending(layer), [...requested]];
    decodes.get("a.png")!.finish();
    expect([beforeList, beforeDecode, await reveal.revealed, pending(layer)]).toEqual([
      [true, false, 0],
      [true, ["a.png"]],
      true,
      false,
    ]);
  });

  it("shows the layer and resolves true when the promised list rejects", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    const reveal = revealWhenDecoded(cache, Promise.reject(new Error("no list")), layer);
    expect([await reveal.revealed, pending(layer), requested]).toEqual([true, false, []]);
  });

  it("shows the layer on cancel before the promised list resolves, and leaves it after", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    let resolve: (urls: readonly string[]) => void = () => undefined;
    const urls = new Promise<readonly string[]>((settle) => {
      resolve = settle;
    });
    const reveal = revealWhenDecoded(cache, urls, layer);
    reveal.cancel();
    const shown = !pending(layer);
    layer.setAttribute(PENDING_ATTRIBUTE, "");
    resolve(["a.png"]);
    await settled(reveal.revealed);
    decodes.get("a.png")!.finish();
    await cache.decoded(["a.png"]);
    expect([shown, await reveal.revealed, pending(layer)]).toEqual([true, false, true]);
  });

  it("cancels a reveal already pending on the layer", async () => {
    const cache = createImageCache(document);
    const layer = document.createElement("div");
    const first = revealWhenDecoded(cache, ["a.png"], layer);
    const second = revealWhenDecoded(cache, ["b.png"], layer);
    decodes.get("a.png")!.finish();
    expect([await first.revealed, pending(layer)]).toEqual([false, true]);
    decodes.get("b.png")!.finish();
    expect([await second.revealed, pending(layer)]).toEqual([true, false]);
  });
});
