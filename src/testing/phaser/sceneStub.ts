// A minimal Phaser Scene stand-in for unit tests, built without loading Phaser: every Phaser
// reference here is a type, so the compiled module imports nothing at runtime.
import type {
  Animations,
  Cache,
  Cameras,
  Events,
  GameObjects,
  Loader,
  Scenes,
  Textures,
  Types,
} from "phaser";

// A test framework's spy factory, such as vitest's vi.fn or jest's jest.fn: it returns a function
// that records its calls and runs impl when given, returning undefined otherwise. Read a member's
// calls through the framework's own typing, for example vi.mocked(stub.scene.start).mock.calls.
export type Spy = (impl?: (...args: never[]) => unknown) => (...args: never[]) => unknown;

// The part of Phaser's EventEmitter the stub's emitters implement.
export type StubEmitter = Pick<
  Events.EventEmitter,
  "emit" | "listenerCount" | "off" | "on" | "once"
>;

// The members of a Scene the stub provides. Methods are spies typed with Phaser's signatures;
// the objects they return are only as complete as described below.
export interface SceneStub {
  // Empty: a test supplies the factories its code calls through overrides.
  add: Partial<GameObjects.GameObjectFactory>;
  // Over a Map: create stores its config as the animation under config.key and returns it, the
  // one already stored for that key, or false without a key.
  anims: Pick<Animations.AnimationManager, "create" | "exists" | "get">;
  // Each cache over its own Map.
  cache: { bitmapFont: StubCache; json: StubCache };
  // At Phaser's default game size, 1024 by 768, scrolled to 0, 0. setScroll sets both scrolls.
  cameras: {
    main: Pick<Cameras.Scene2D.Camera, "height" | "scrollX" | "scrollY" | "setScroll" | "width">;
  };
  // The Scene's own emitter, apart from game.events.
  events: StubEmitter;
  // canvas is an object with an empty style.
  game: { canvas: HTMLCanvasElement; events: StubEmitter };
  // An emitter whose file methods record their calls and load nothing; tests emit the loader's
  // events.
  load: Pick<Loader.LoaderPlugin, keyof StubEmitter | "bitmapFont" | "image" | "json" | "setPath">;
  scene: Pick<Scenes.ScenePlugin, "launch" | "start" | "stop">;
  // As Phaser: list holds the textures by key, which a test seeds; exists is true for a key in
  // list, and get returns its texture or, for any other key, one shared __MISSING texture with
  // no sources.
  textures: Pick<Textures.TextureManager, "exists" | "get"> & {
    list: Record<string, Textures.Texture>;
  };
}

// The part of a Phaser cache the stub implements.
export type StubCache = Pick<Cache.BaseCache, "add" | "exists" | "get" | "remove">;

// A SceneStub with overrides' members in place of its own.
export type SceneStubWith<Overrides extends object> = Omit<SceneStub, keyof Overrides> & Overrides;

type Listener = { context: unknown; fn: (...args: never[]) => unknown; once: boolean };

function emitter(): StubEmitter {
  const listeners = new Map<string | symbol, Listener[]>();
  const add = (event: string | symbol, fn: Listener["fn"], context: unknown, once: boolean) => {
    listeners.set(event, [...(listeners.get(event) ?? []), { context, fn, once }]);
    return self;
  };
  const self = {
    emit: (event: string | symbol, ...args: unknown[]) => {
      const current = listeners.get(event) ?? [];
      listeners.set(
        event,
        current.filter((listener) => !listener.once),
      );
      for (const { context, fn } of current) {
        (fn as (...args: unknown[]) => unknown).apply(context, args);
      }
      return current.length > 0;
    },
    listenerCount: (event: string | symbol) => listeners.get(event)?.length ?? 0,
    // As eventemitter3: without fn every listener goes; context and once narrow the match.
    off: (event: string | symbol, fn?: Listener["fn"], context?: unknown, once?: boolean) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter(
          (listener) =>
            fn !== undefined &&
            (listener.fn !== fn ||
              (context !== undefined && listener.context !== context) ||
              (once === true && !listener.once)),
        ),
      );
      return self;
    },
    on: (event: string | symbol, fn: Listener["fn"], context?: unknown) =>
      add(event, fn, context, false),
    once: (event: string | symbol, fn: Listener["fn"], context?: unknown) =>
      add(event, fn, context, true),
  } as unknown as StubEmitter;
  return self;
}

// A Scene stand-in whose methods are made by spy, with overrides' members replacing or adding to
// its own. Pass it where code takes a Scene with `as unknown as Scene`: it holds only the members
// above. To stand in for Phaser's Scene class, a vi.mock("phaser") factory imports this module
// with `await import` and returns
// `Scene: class { constructor() { Object.assign(this, sceneStub(vi.fn)); } }`.
export function sceneStub<Overrides extends object = Record<never, never>>(
  spy: Spy,
  overrides?: Overrides,
): SceneStubWith<Overrides> {
  const fake = <F>(impl?: (...args: never[]) => unknown): F => spy(impl) as unknown as F;

  const animations = new Map<string, Animations.Animation>();
  const anims: SceneStub["anims"] = {
    create: fake((config: Types.Animations.Animation) => {
      const { key } = config;
      if (typeof key !== "string" || key === "") {
        return false;
      }
      if (!animations.has(key)) {
        animations.set(key, config as unknown as Animations.Animation);
      }
      return animations.get(key);
    }),
    exists: fake((key: string) => animations.has(key)),
    get: fake((key: string) => animations.get(key)),
  };

  const cache = (): StubCache => {
    const entries = new Map<string, unknown>();
    const self: StubCache = {
      add: fake((key: string, data: unknown) => {
        entries.set(key, data);
        return self;
      }),
      exists: fake((key: string) => entries.has(key)),
      get: fake((key: string) => entries.get(key)),
      remove: fake((key: string) => {
        entries.delete(key);
        return self;
      }),
    };
    return self;
  };

  const main = {
    height: 768,
    scrollX: 0,
    scrollY: 0,
    width: 1024,
  } as SceneStub["cameras"]["main"];
  main.setScroll = fake((x: number, y: number = x) => {
    main.scrollX = x;
    main.scrollY = y;
    return main;
  });

  const load = emitter() as unknown as SceneStub["load"];
  for (const name of ["bitmapFont", "image", "json", "setPath"] as const) {
    load[name] = fake(() => load);
  }

  const plugin = {} as SceneStub["scene"];
  for (const name of ["launch", "start", "stop"] as const) {
    plugin[name] = fake(() => plugin);
  }

  const missing = { key: "__MISSING", source: [] } as unknown as Textures.Texture;
  const list: Record<string, Textures.Texture> = {};
  const textures: SceneStub["textures"] = {
    exists: fake((key: string) => Object.hasOwn(list, key)),
    get: fake((key: string) => (Object.hasOwn(list, key) ? list[key] : missing)),
    list,
  };

  const stub: SceneStub = {
    add: {},
    anims,
    cache: { bitmapFont: cache(), json: cache() },
    cameras: { main },
    events: emitter(),
    game: { canvas: { style: {} } as HTMLCanvasElement, events: emitter() },
    load,
    scene: plugin,
    textures,
  };
  return Object.assign(stub, overrides) as SceneStubWith<Overrides>;
}
