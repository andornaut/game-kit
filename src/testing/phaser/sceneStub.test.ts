import type { Cameras, GameObjects, Loader, Scene, Scenes } from "phaser";
import { describe, expect, it, vi } from "vitest";

import {
  type SceneStub,
  sceneStub,
  type Spy,
  type StubGameObject,
  type StubTexture,
} from "./sceneStub.ts";

// The stub is built from types alone: a runtime Phaser import fails the module's load.
vi.mock("phaser", () => {
  throw new Error("sceneStub loaded Phaser");
});

const stub = () => sceneStub(vi.fn);

// What an add factory returned, as the stub's game object.
const made = (object: unknown) => object as StubGameObject;

describe("sceneStub", () => {
  // Each spy member, a call to it and what it returns: "self" for its owner, for chaining.
  it.each<[string, (scene: SceneStub) => [unknown, (...args: never[]) => unknown, unknown]]>([
    ["scene.launch", (s) => [s.scene.launch("pause", { a: 1 }), s.scene.launch, s.scene]],
    ["scene.start", (s) => [s.scene.start("zone"), s.scene.start, s.scene]],
    ["scene.stop", (s) => [s.scene.stop("dialogue"), s.scene.stop, s.scene]],
    ["scene.pause", (s) => [s.scene.pause(), s.scene.pause, s.scene]],
    ["scene.resume", (s) => [s.scene.resume("zone"), s.scene.resume, s.scene]],
    ["scene.moveAbove", (s) => [s.scene.moveAbove("zone", "bark"), s.scene.moveAbove, s.scene]],
    ["scene.setVisible", (s) => [s.scene.setVisible(false), s.scene.setVisible, s.scene]],
    ["input.stopPropagation", (s) => [s.input.stopPropagation(), s.input.stopPropagation, s.input]],
    [
      "cameras.main.setBackgroundColor",
      (s) => [
        s.cameras.main.setBackgroundColor(0),
        s.cameras.main.setBackgroundColor,
        s.cameras.main,
      ],
    ],
    [
      "cameras.main.setBounds",
      (s) => [s.cameras.main.setBounds(0, 0, 9, 9), s.cameras.main.setBounds, s.cameras.main],
    ],
    [
      "cameras.main.ignore",
      (s) => [s.cameras.main.ignore([]), s.cameras.main.ignore, s.cameras.main],
    ],
    ["cameras.main.pan", (s) => [s.cameras.main.pan(1, 2), s.cameras.main.pan, s.cameras.main]],
    [
      "cameras.main.setZoom",
      (s) => [s.cameras.main.setZoom(2), s.cameras.main.setZoom, s.cameras.main],
    ],
    [
      "game.renderer.snapshotArea",
      (s) => [
        s.game.renderer.snapshotArea(0, 0, 1, 1, () => undefined),
        s.game.renderer.snapshotArea,
        s.game.renderer,
      ],
    ],
    ["textures.remove", (s) => [s.textures.remove("k"), s.textures.remove, s.textures]],
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
    // A seeded texture needs no cast: its methods may return anything.
    const font: StubTexture = { key: "font", setFilter: () => undefined, source: [{}] };
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
    ["input", (scene) => scene.input],
    ["input.keyboard", (scene) => scene.input.keyboard],
    ["scale", (scene) => scene.scale],
    ["a game object", (scene) => made(scene.add.image(0, 0, "i"))],
    ["a tween", (scene) => scene.tweens.add({ targets: [] }) as unknown as SceneStub["events"]],
  ])("emits %s events to its listeners", (_name, of) => {
    const events = of(stub());
    const calls: unknown[][] = [];
    const context = { name: "context" };
    const always = vi.fn(function (this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
    });
    const once = vi.fn();
    expect(events.eventNames()).toEqual([]);
    events.on("loaderror", always, context);
    events.once("loaderror", once);
    expect(events.listenerCount("loaderror")).toBe(2);
    expect(events.eventNames()).toEqual(["loaderror"]);
    expect(events.listeners("loaderror")).toEqual([always, once]);
    expect(events.emit("loaderror", { key: "k" })).toBe(true);
    expect(events.emit("loaderror", { key: "j" })).toBe(true);
    expect(calls).toEqual([
      [context, { key: "k" }],
      [context, { key: "j" }],
    ]);
    expect(once).toHaveBeenCalledExactlyOnceWith({ key: "k" });
    // Detached methods stay bound to their emitter.
    const { removeListener } = events;
    removeListener("loaderror", always, { other: true });
    expect(events.listenerCount("loaderror")).toBe(1);
    events.off("loaderror", always, context);
    expect(events.listenerCount("loaderror")).toBe(0);
    expect(events.emit("loaderror")).toBe(false);
    events.on("complete", always).on("complete", once);
    events.off("complete");
    expect(events.listenerCount("complete")).toBe(0);
    expect(events.eventNames()).toEqual([]);
    events.addListener("a", always).on("b", always);
    expect(events.removeAllListeners("a").eventNames()).toEqual(["b"]);
    expect(events.removeAllListeners().eventNames()).toEqual([]);
  });

  it("tracks scene status at once, defaulting to its own key", () => {
    const scene = sceneStub(vi.fn, {}, { key: "zone" });
    expect([scene.scene.key, scene.sys.settings.key]).toEqual(["zone", "zone"]);
    expect([scene.scene.isActive(), scene.scene.isPaused(), scene.sys.isActive()]).toEqual([
      true,
      false,
      true,
    ]);
    expect(scene.scene.get("zone")).toBe(scene);
    expect(scene.scene.get("other")).toBeNull();
    expect(scene.game.scene.getScenes()).toEqual([scene]);
    scene.scene.pause();
    expect([scene.scene.isPaused("zone"), scene.sys.isPaused()]).toEqual([true, true]);
    expect(scene.game.scene.getScenes(true)).toEqual([]);
    expect(scene.game.scene.getScenes(false)).toEqual([scene]);
    scene.scene.resume();
    scene.scene.launch("pause");
    expect(scene.scene.isActive("pause")).toBe(true);
    scene.scene.stop("pause");
    expect(scene.scene.isActive("pause")).toBe(false);
    expect(stub().scene.key).toBe("default");
  });

  it("starts input enabled with an enabled keyboard and no pointers", () => {
    const { input } = stub();
    expect(input).toMatchObject({ enabled: true, keyboard: { enabled: true } });
    expect(input.manager.pointers).toEqual([]);
  });

  it("holds the main camera in cameras, and adds and removes others", () => {
    const { cameras } = stub();
    const { main } = cameras;
    expect(main).toMatchObject({ useBounds: false, visible: true, x: 0, y: 0, zoom: 1 });
    expect(main.panEffect).toMatchObject({ isRunning: false });
    main.setVisible(false).setBounds(0, 0, 10, 10).setZoom(2);
    expect(main).toMatchObject({ useBounds: true, visible: false, zoom: 2 });
    const hud = cameras.add(1, 2, 30, 40) as unknown as Cameras.Scene2D.Camera;
    expect(hud).toMatchObject({ height: 40, width: 30, x: 1, y: 2 });
    expect(cameras.cameras).toEqual([main, hud]);
    expect(cameras.remove(hud)).toBe(1);
    expect(cameras.cameras).toEqual([main]);
  });

  // Each add factory, a call to it and what the game object it makes holds.
  it.each<[string, (scene: SceneStub) => unknown, Partial<StubGameObject>]>([
    [
      "bitmapText",
      (s) => s.add.bitmapText(1, 2, "font", ["a", "b"]),
      { font: "font", text: "a\nb", type: "BitmapText" },
    ],
    ["graphics", (s) => s.add.graphics(), { type: "Graphics", x: 0 }],
    [
      "image",
      (s) => s.add.image(1, 2, "key", 3),
      { frame: { name: "3" }, texture: { key: "key" }, type: "Image" },
    ],
    [
      "nineslice",
      (s) => s.add.nineslice(1, 2, "key", "f", 30, 40),
      { height: 40, type: "NineSlice", width: 30 },
    ],
    [
      "rectangle",
      (s) => s.add.rectangle(1, 2, 30, 40),
      { height: 40, type: "Rectangle", width: 30 },
    ],
    ["sprite", (s) => s.add.sprite(1, 2, "key"), { texture: { key: "key" }, type: "Sprite" }],
  ])("adds a %s to the display list", (name, call, fields) => {
    const scene = stub();
    const object = made(call(scene));
    expect(object).toMatchObject({ active: true, scene, ...fields });
    if (name !== "graphics") {
      expect([object.x, object.y]).toEqual([1, 2]);
    }
    expect(scene.children.list).toEqual([object]);
  });

  it("records game object setters, nests containers and destroys", () => {
    const scene = stub();
    const image = made(scene.add.image(0, 0, "i"));
    expect(
      image
        .setOrigin(0)
        .setPosition(3, 4)
        .setDepth(5)
        .setScale(2)
        .setAlpha(0.5)
        .setTint(1)
        .setVisible(false)
        .setDisplaySize(6, 7)
        .setScrollFactor(0)
        .setTexture("j", "f")
        .fillRect(0, 0, 1, 1),
    ).toBe(image);
    expect(image).toMatchObject({
      alpha: 0.5,
      depth: 5,
      displayHeight: 7,
      displayWidth: 6,
      frame: { name: "f" },
      originX: 0,
      originY: 0,
      scaleX: 2,
      scaleY: 2,
      scrollFactorX: 0,
      texture: { key: "j" },
      tint: 1,
      visible: false,
      x: 3,
      y: 4,
    });
    const container = made(scene.add.container(0, 0, [image as unknown as GameObjects.GameObject]));
    expect(container.list).toEqual([image]);
    expect(scene.children.list).toEqual([container]);
    const destroyed = vi.fn();
    image.once("destroy", destroyed);
    container.remove(image, true);
    expect(container.list).toEqual([]);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(image.active).toBe(false);
    container.destroy();
    expect(scene.children.list).toEqual([]);
    const loose = made(scene.make.graphics());
    expect(loose.type).toBe("Graphics");
    expect(scene.children.list).toEqual([]);
  });

  it("creates canvas and image textures under free keys, and removes them", () => {
    const { textures } = stub();
    const canvas = textures.createCanvas("c", 2, 2) as unknown as {
      getContext(): CanvasRenderingContext2D;
      refresh(): unknown;
    };
    expect(textures.createCanvas("c")).toBeNull();
    expect(textures.exists("c")).toBe(true);
    expect(canvas.refresh()).toBe(canvas);
    const context = canvas.getContext();
    const pixel = context.createImageData(1, 1);
    pixel.data.set([1, 2, 3, 4]);
    context.putImageData(pixel, 1, 1);
    expect([...context.getImageData(0, 0, 2, 2).data]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4,
    ]);
    context.clearRect(1, 1, 1, 1);
    expect([...context.getImageData(1, 1, 1, 1).data]).toEqual([0, 0, 0, 0]);
    expect(textures.getFrame("c")).toMatchObject({ height: 2, name: "__BASE", width: 2 });
    expect(textures.getFrame("missing")).toBeUndefined();
    const image = { height: 3, width: 4 } as HTMLImageElement;
    expect(textures.addImage("i", image)).toMatchObject({
      key: "i",
      source: [{ height: 3, image, width: 4 }],
    });
    expect(textures.addImage("i", image)).toBeNull();
    expect(textures.remove("i")).toBe(textures);
    expect(Object.keys(textures.list)).toEqual(["c"]);
  });

  it("answers exists for any texture or animation key when asked to", () => {
    const plain = stub();
    expect([plain.textures.exists("x"), plain.anims.exists("x")]).toEqual([false, false]);
    const any = sceneStub(vi.fn, {}, { anyAnimation: true, anyTexture: true });
    expect([any.textures.exists("x"), any.anims.exists("x")]).toEqual([true, true]);
    expect(any.textures.get("x")).toMatchObject({ key: "__MISSING" });
    expect(any.anims.get("x")).toBeUndefined();
  });

  it("schedules timers and tweens that never run", () => {
    const scene = stub();
    expect(scene.time.now).toBe(0);
    const callback = vi.fn();
    const timer = scene.time.delayedCall(100, callback, [1]);
    expect(timer).toMatchObject({ args: [1], callback, delay: 100, hasDispatched: false });
    timer.remove();
    expect(timer.hasDispatched).toBe(true);
    expect(scene.time.addEvent({ callback, delay: 5, loop: true })).toMatchObject({
      delay: 5,
      loop: true,
    });
    expect(callback).not.toHaveBeenCalled();
    expect(vi.mocked(scene.time.delayedCall).mock.calls[0]?.[1]).toBe(callback);
    const target = {};
    const tween = scene.tweens.add({ targets: target });
    expect(tween.targets).toEqual([target]);
    expect(tween.stop()).toBe(tween);
  });

  it("starts the game loop, loader list and scale at rest", () => {
    const scene = stub();
    expect(scene.game.loop).toEqual({ delta: 0, now: 0, time: 0 });
    expect(scene.load.list).toEqual(new Set());
    expect(scene.scale).toMatchObject({
      gameSize: { height: 768, width: 1024 },
      height: 768,
      width: 1024,
    });
  });

  describe("overrides", () => {
    it("merge an object literal into the member, keeping its other spies and getters", () => {
      const get = vi.fn();
      let now = 5;
      const scene = sceneStub(vi.fn, {
        game: { loop: { time: 9 } },
        scene: { get },
        time: {
          get now() {
            return now;
          },
        },
      });
      expect(scene.scene.get).toBe(get);
      expect(vi.isMockFunction(scene.scene.start)).toBe(true);
      expect(scene.scene.start("a")).toBe(scene.scene);
      now = 6;
      expect(scene.time.now).toBe(6);
      expect(vi.isMockFunction(scene.time.delayedCall)).toBe(true);
      expect(scene.game.loop).toEqual({ time: 9 });
      expect(scene.game.events.listenerCount("x")).toBe(0);
    });

    it("merge one level deep only", () => {
      const scene = sceneStub(vi.fn, { cameras: { main: { scrollX: 4 } } });
      expect(scene.cameras.main).toEqual({ scrollX: 4 });
      expect(vi.isMockFunction(scene.cameras.add)).toBe(true);
    });

    it("merge another stub's game, keeping its emitter", () => {
      const { game } = stub();
      const scene = sceneStub(vi.fn, { game });
      expect(scene.game.events).toBe(game.events);
    });

    // Each override that is not an object literal: it replaces the member.
    it.each<[string, () => object]>([
      [
        "a class instance",
        () =>
          new (class Custom {
            list = [1];
          })(),
      ],
      ["another stub's emitter", () => stub().events],
      ["a function", () => vi.fn()],
      ["an array", () => [1]],
    ])("replace the member with %s", (_name, make) => {
      const value = make();
      const scene = sceneStub(vi.fn, { load: value });
      expect(scene.load).toBe(value);
    });

    it("add members the stub lacks", () => {
      const physics = { world: {} };
      expect(sceneStub(vi.fn, { physics }).physics).toBe(physics);
    });
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
