import type { Cameras, Loader, Scene, Scenes, Textures } from "phaser";
import { describe, expect, it, vi } from "vitest";

import { type SceneStub, sceneStub, type Spy } from "./sceneStub.ts";

// The stub is built from types alone: a runtime Phaser import fails the module's load.
vi.mock("phaser", () => {
  throw new Error("sceneStub loaded Phaser");
});

const stub = () => sceneStub(vi.fn);

describe("sceneStub", () => {
  // Each spy member, a call to it and what it returns: "self" for its owner, for chaining.
  it.each<[string, (scene: SceneStub) => [unknown, (...args: never[]) => unknown, unknown]]>([
    ["scene.launch", (s) => [s.scene.launch("pause", { a: 1 }), s.scene.launch, s.scene]],
    ["scene.start", (s) => [s.scene.start("zone"), s.scene.start, s.scene]],
    ["scene.stop", (s) => [s.scene.stop("dialogue"), s.scene.stop, s.scene]],
    [
      "load.bitmapFont",
      (s) => [s.load.bitmapFont("f", "f.png", "f.fnt"), s.load.bitmapFont, s.load],
    ],
    ["load.image", (s) => [s.load.image("i", "i.png"), s.load.image, s.load]],
    ["load.json", (s) => [s.load.json("j", "j.json"), s.load.json, s.load]],
    ["load.setPath", (s) => [s.load.setPath("art/"), s.load.setPath, s.load]],
    [
      "cameras.main.setScroll",
      (s) => [s.cameras.main.setScroll(3), s.cameras.main.setScroll, s.cameras.main],
    ],
    ["cache.json.add", (s) => [s.cache.json.add("k", 1), s.cache.json.add, s.cache.json]],
    ["cache.json.remove", (s) => [s.cache.json.remove("k"), s.cache.json.remove, s.cache.json]],
    [
      "cache.bitmapFont.add",
      (s) => [s.cache.bitmapFont.add("k", 1), s.cache.bitmapFont.add, s.cache.bitmapFont],
    ],
    [
      "cache.bitmapFont.remove",
      (s) => [s.cache.bitmapFont.remove("k"), s.cache.bitmapFont.remove, s.cache.bitmapFont],
    ],
  ])("records calls to %s and returns its owner", (_name, call) => {
    const scene = stub();
    const [result, spy, owner] = call(scene);
    expect(result).toBe(owner);
    expect(vi.isMockFunction(spy)).toBe(true);
    expect(vi.mocked(spy).mock.calls).toHaveLength(1);
  });

  it("starts with an empty add", () => {
    expect(stub().add).toEqual({});
  });

  it.each<[string, (scene: SceneStub) => SceneStub["cache"]["json"]]>([
    ["json", (scene) => scene.cache.json],
    ["bitmapFont", (scene) => scene.cache.bitmapFont],
  ])("keeps %s cache entries until removed", (_name, of) => {
    const scene = stub();
    const cache = of(scene);
    const data = { a: 1 };
    expect(cache.exists("key")).toBe(false);
    expect(cache.get("key")).toBeUndefined();
    cache.add("key", data);
    expect(cache.exists("key")).toBe(true);
    expect(cache.get("key")).toBe(data);
    expect(cache.add).toHaveBeenCalledExactlyOnceWith("key", data);
    const other = cache === scene.cache.json ? scene.cache.bitmapFont : scene.cache.json;
    expect(other.exists("key")).toBe(false);
    cache.remove("key");
    expect(cache.exists("key")).toBe(false);
    expect(cache.get("key")).toBeUndefined();
    expect(cache.remove).toHaveBeenCalledExactlyOnceWith("key");
  });

  it("creates animations once per key and returns false without one", () => {
    const { anims } = stub();
    const walk = { frames: [{ key: "a" }], key: "walk" };
    expect(anims.exists("walk")).toBe(false);
    expect(anims.get("walk")).toBeUndefined();
    expect(anims.create(walk)).toBe(walk);
    expect(anims.create({ frames: [], key: "walk" })).toBe(walk);
    expect(anims.create({})).toBe(false);
    expect(anims.exists("walk")).toBe(true);
    expect(anims.get("walk")).toBe(walk);
    expect(anims.create).toHaveBeenCalledTimes(3);
  });

  it("serves seeded textures, and the missing texture for any other key", () => {
    const { textures } = stub();
    const missing = textures.get("font");
    expect(missing).toEqual({ key: "__MISSING", source: [] });
    expect(textures.get("other")).toBe(missing);
    expect(textures.exists("font")).toBe(false);
    const font = { key: "font", source: [{}] } as unknown as Textures.Texture;
    textures.list.font = font;
    expect(textures.exists("font")).toBe(true);
    expect(textures.get("font")).toBe(font);
    expect(textures.exists("toString")).toBe(false);
    expect(textures.get).toHaveBeenCalledTimes(3);
  });

  it("starts the camera at Phaser's default size and scrolls it", () => {
    const { main } = stub().cameras;
    expect(main).toMatchObject({ height: 768, scrollX: 0, scrollY: 0, width: 1024 });
    main.setScroll(5);
    expect(main).toMatchObject({ scrollX: 5, scrollY: 5 });
    main.setScroll(7, 9);
    expect(main).toMatchObject({ scrollX: 7, scrollY: 9 });
    main.scrollX = 7300;
    expect(main.scrollX).toBe(7300);
  });

  it("gives the game a styleable canvas", () => {
    const { canvas } = stub().game;
    canvas.style.visibility = "hidden";
    expect(canvas.style.visibility).toBe("hidden");
  });

  // Both emitters, as eventemitter3 behaves: on, once, off by listener, context and all.
  it.each<[string, (scene: SceneStub) => SceneStub["game"]["events"]]>([
    ["load", (scene) => scene.load],
    ["events", (scene) => scene.events],
    ["game.events", (scene) => scene.game.events],
  ])("emits %s events to its listeners", (_name, of) => {
    const events = of(stub());
    const calls: unknown[][] = [];
    const context = { name: "context" };
    const always = vi.fn(function (this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
    });
    const once = vi.fn();
    events.on("loaderror", always, context);
    events.once("loaderror", once);
    expect(events.listenerCount("loaderror")).toBe(2);
    expect(events.emit("loaderror", { key: "k" })).toBe(true);
    expect(events.emit("loaderror", { key: "j" })).toBe(true);
    expect(calls).toEqual([
      [context, { key: "k" }],
      [context, { key: "j" }],
    ]);
    expect(once).toHaveBeenCalledExactlyOnceWith({ key: "k" });
    events.off("loaderror", always, { other: true });
    expect(events.listenerCount("loaderror")).toBe(1);
    events.off("loaderror", always, context);
    expect(events.listenerCount("loaderror")).toBe(0);
    expect(events.emit("loaderror")).toBe(false);
    events.on("complete", always).on("complete", once);
    events.off("complete");
    expect(events.listenerCount("complete")).toBe(0);
  });

  it("gives each stub its own state", () => {
    const first = stub();
    const second = stub();
    first.cache.json.add("k", 1);
    first.game.events.on("blur", () => undefined);
    first.events.on("pause", () => undefined);
    expect(second.cache.json.exists("k")).toBe(false);
    expect(second.game.events.listenerCount("blur")).toBe(0);
    expect(second.events.listenerCount("pause")).toBe(0);
    expect(first.game.events.listenerCount("pause")).toBe(0);
    expect(second.scene.start).not.toBe(first.scene.start);
  });

  it("replaces and adds members from overrides", () => {
    const image = vi.fn();
    const input = { enabled: false };
    const scene = sceneStub(vi.fn, { add: { image }, input });
    expect(scene.add.image).toBe(image);
    expect(scene.input).toBe(input);
    expect(vi.isMockFunction(scene.scene.start)).toBe(true);
  });

  // The type checker proves this case; at runtime it only runs the calls.
  it("passes where code takes the Phaser members it provides, and needs a cast for a Scene", () => {
    // vitest's spy factory fits the injected Spy.
    const spy: Spy = vi.fn;
    const scene = sceneStub(spy);
    const starts = (target: { scene: Pick<Scenes.ScenePlugin, "start"> }) =>
      target.scene.start("a");
    const loads = (target: { load: Pick<Loader.LoaderPlugin, "json" | "on"> }) => target.load;
    const scrolls = (target: { cameras: { main: Pick<Cameras.Scene2D.Camera, "scrollX"> } }) =>
      target.cameras.main.scrollX;
    expect(starts(scene)).toBe(scene.scene);
    expect(loads(scene)).toBe(scene.load);
    expect(scrolls(scene)).toBe(0);
    // @ts-expect-error A whole Scene has many more members.
    const whole: Scene = scene;
    expect(whole).toBe(scene as unknown as Scene);
  });
});
