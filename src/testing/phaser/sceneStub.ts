// A Phaser Scene stand-in for unit tests, built without loading Phaser: every Phaser reference
// here is a type, so the compiled module imports nothing at runtime. Its members are complete
// for the scene tests it serves; a test extends it through overrides.
import type {
  Animations,
  Cache,
  Cameras,
  Core,
  Events,
  GameObjects,
  Input,
  Loader,
  Renderer,
  Scale,
  Scenes,
  Structs,
  Textures,
  Time,
  Tweens,
  Types,
} from "phaser";

// A test framework's spy factory, such as vitest's vi.fn or jest's jest.fn: it returns a function
// that records its calls and runs impl when given, returning undefined otherwise. Read a member's
// calls through the framework's own typing, for example vi.mocked(stub.scene.start).mock.calls.
export type Spy = (impl?: (...args: never[]) => unknown) => (...args: never[]) => unknown;

// The part of Phaser's EventEmitter the stub's emitters implement.
export type StubEmitter = Pick<
  Events.EventEmitter,
  | "addListener"
  | "emit"
  | "eventNames"
  | "listenerCount"
  | "listeners"
  | "off"
  | "on"
  | "once"
  | "removeAllListeners"
  | "removeListener"
>;

// The part of a Phaser cache the stub implements.
export type StubCache = Pick<Cache.BaseCache, "add" | "exists" | "get" | "remove">;

// A camera: at the given bounds, scrolled to 0, 0, visible and with no effect running.
export type StubCamera = Pick<
  Cameras.Scene2D.Camera,
  | "height"
  | "ignore"
  | "pan"
  | "scrollX"
  | "scrollY"
  | "setBackgroundColor"
  | "setBounds"
  | "setScroll"
  | "setVisible"
  | "setZoom"
  | "useBounds"
  | "visible"
  | "width"
  | "x"
  | "y"
  | "zoom"
> & { panEffect: Pick<Cameras.Scene2D.Effects.Pan, "isRunning" | "reset"> };

// A texture as a test seeds it into textures.list: any of Texture's members, with methods that
// may return anything and arrays of partial elements.
export type StubTexture = {
  [K in keyof Textures.Texture]?: Textures.Texture[K] extends (...args: infer A) => unknown
    ? (...args: A) => unknown
    : Textures.Texture[K] extends readonly (infer E)[]
      ? readonly Partial<E>[]
      : Textures.Texture[K];
};

// The Game Object every add and make factory returns, whatever its kind: an emitter whose
// setters record their values and return it. destroy marks it inactive, emits "destroy",
// removes its listeners and takes it off the display list.
export interface StubGameObject extends StubEmitter {
  active: boolean;
  alpha: number;
  depth: number;
  displayHeight: number;
  displayWidth: number;
  // A BitmapText's font and text.
  font: string;
  frame: { name: string };
  height: number;
  // A Container's children.
  list: StubGameObject[];
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  scene: SceneStub;
  scrollFactorX: number;
  scrollFactorY: number;
  text: string;
  texture: { key: string };
  tint: number;
  // Phaser's class name, such as "Image" or "Graphics".
  type: string;
  visible: boolean;
  width: number;
  x: number;
  y: number;
  // Each method below is a spy; each but destroy returns the object.
  add(child: StubGameObject | StubGameObject[]): StubGameObject;
  beginPath(): StubGameObject;
  clear(): StubGameObject;
  clearMask(): StubGameObject;
  clearTint(): StubGameObject;
  closePath(): StubGameObject;
  destroy(): void;
  disableInteractive(): StubGameObject;
  fillCircle(...args: number[]): StubGameObject;
  fillPath(): StubGameObject;
  fillRect(...args: number[]): StubGameObject;
  fillRoundedRect(...args: number[]): StubGameObject;
  fillStyle(color: number, alpha?: number): StubGameObject;
  generateTexture(key: string, width?: number, height?: number): StubGameObject;
  lineStyle(width: number, color: number, alpha?: number): StubGameObject;
  lineTo(x: number, y: number): StubGameObject;
  moveTo(x: number, y: number): StubGameObject;
  play(key: unknown, ignoreIfPlaying?: boolean): StubGameObject;
  remove(child: StubGameObject | StubGameObject[], destroyChild?: boolean): StubGameObject;
  setAlpha(alpha: number): StubGameObject;
  setData(key: string, value: unknown): StubGameObject;
  setDepth(depth: number): StubGameObject;
  setDisplaySize(width: number, height: number): StubGameObject;
  setFillStyle(color?: number, alpha?: number): StubGameObject;
  setFlipX(flip: boolean): StubGameObject;
  setFrame(frame: string | number): StubGameObject;
  setInteractive(...args: unknown[]): StubGameObject;
  setLineSpacing(spacing: number): StubGameObject;
  setMask(mask: unknown): StubGameObject;
  setOrigin(x?: number, y?: number): StubGameObject;
  setPosition(x?: number, y?: number): StubGameObject;
  setScale(x: number, y?: number): StubGameObject;
  setScrollFactor(x: number, y?: number): StubGameObject;
  setSize(width: number, height: number): StubGameObject;
  setStrokeStyle(width?: number, color?: number, alpha?: number): StubGameObject;
  setText(text: string | string[]): StubGameObject;
  setTexture(key: string, frame?: string | number): StubGameObject;
  setTint(tint: number): StubGameObject;
  setVisible(visible: boolean): StubGameObject;
  setX(x: number): StubGameObject;
  setY(y: number): StubGameObject;
  stop(): StubGameObject;
  strokeCircle(...args: number[]): StubGameObject;
  strokePath(): StubGameObject;
  strokeRect(...args: number[]): StubGameObject;
  strokeRoundedRect(...args: number[]): StubGameObject;
}

// The members of a Scene the stub provides. Methods are spies typed with Phaser's signatures;
// the objects they return are StubGameObject, StubCamera or the shapes described below.
export interface SceneStub {
  // Each factory returns a StubGameObject at the given position, with the texture and frame,
  // font and text, size or children it was given, and puts it on children.list. A container
  // takes its children off the display list, as Phaser does.
  add: Pick<
    GameObjects.GameObjectFactory,
    "bitmapText" | "container" | "graphics" | "image" | "nineslice" | "rectangle" | "sprite"
  >;
  // Over a Map: create stores its config as the animation under config.key and returns it, the
  // one already stored for that key, or false without a key. exists is true for a stored key,
  // or for any key with the anyAnimation option.
  anims: Pick<Animations.AnimationManager, "create" | "exists" | "get">;
  // Each cache over its own Map.
  cache: { bitmapFont: StubCache; json: StubCache };
  // main is at Phaser's default game size, 1024 by 768, and cameras starts holding it. add
  // makes a camera at the bounds given (the game size by default) and appends it; remove takes
  // one out of cameras.
  cameras: Pick<Cameras.Scene2D.CameraManager, "add" | "remove"> & {
    cameras: StubCamera[];
    main: StubCamera;
  };
  // The display list: what the add factories made and have not destroyed.
  children: { list: StubGameObject[] };
  // The Scene's own emitter, apart from game.events.
  events: StubEmitter;
  // canvas is an object with an empty style. loop starts at 0. renderer.snapshotArea records
  // its call and never calls back. scene.getScenes returns this stub when it matches isActive.
  game: {
    canvas: HTMLCanvasElement;
    events: StubEmitter;
    loop: Pick<Core.TimeStep, "delta" | "now" | "time">;
    renderer: Pick<Renderer.Canvas.CanvasRenderer, "snapshotArea">;
    scene: Pick<Scenes.SceneManager, "getScenes">;
  };
  // An enabled emitter whose keyboard is an enabled emitter and whose manager has no pointers.
  input: Pick<Input.InputPlugin, keyof StubEmitter | "enabled" | "stopPropagation"> & {
    keyboard: Pick<Input.Keyboard.KeyboardPlugin, keyof StubEmitter | "enabled">;
    manager: Pick<Input.InputManager, "pointers">;
  };
  // An emitter whose file methods record their calls and load nothing; list is an empty Set.
  // Tests emit the loader's events.
  load: Pick<
    Loader.LoaderPlugin,
    keyof StubEmitter | "bitmapFont" | "image" | "json" | "list" | "setPath"
  >;
  // graphics returns a StubGameObject that is not on the display list.
  make: Pick<GameObjects.GameObjectCreator, "graphics">;
  // An emitter at the game size.
  scale: Pick<Scale.ScaleManager, keyof StubEmitter | "height" | "width"> & {
    gameSize: Pick<Structs.Size, "height" | "width">;
  };
  // key is the key option. Each scene's status changes at once, unlike Phaser, which queues
  // the change to the next step: this scene starts running; launch, start and resume run a
  // scene, pause pauses it, and stop stops it, each defaulting to this scene where Phaser does.
  // isActive and isPaused read the status, of this scene by default. get returns this stub for
  // its own key and null for any other.
  scene: Pick<
    Scenes.ScenePlugin,
    | "get"
    | "isActive"
    | "isPaused"
    | "key"
    | "launch"
    | "moveAbove"
    | "pause"
    | "resume"
    | "setVisible"
    | "start"
    | "stop"
  >;
  // The Scene's Systems: isActive and isPaused as scene's for this scene; settings.key is key.
  sys: Pick<Scenes.Systems, "isActive" | "isPaused"> & {
    settings: Pick<Types.Scenes.SettingsObject, "key">;
  };
  // As Phaser: list holds the textures by key; exists is true for a key in list, or any key with
  // the anyTexture option; get returns a listed texture or, for any other key, one shared
  // __MISSING texture with no sources; getFrame returns the frame a listed texture's get gives,
  // or undefined. createCanvas and addImage list a new texture under a free key and return it,
  // or null for a listed key; remove takes a texture out of list.
  textures: Pick<
    Textures.TextureManager,
    "addImage" | "createCanvas" | "exists" | "get" | "getFrame" | "remove"
  > & {
    list: Record<string, StubTexture>;
  };
  // now starts at 0 and never advances. addEvent and delayedCall return a TimerEvent shape built
  // from their arguments and never call back: a test runs the callback from the spy's calls.
  time: Pick<Time.Clock, "addEvent" | "delayedCall" | "now">;
  // add returns an emitting Tween shape over the config's targets that never plays.
  tweens: Pick<Tweens.TweenManager, "add">;
}

export interface SceneStubOptions {
  // anims.exists answers true for every key.
  anyAnimation?: boolean;
  // textures.exists answers true for every key.
  anyTexture?: boolean;
  // The scene's key, "default" when absent.
  key?: string;
}

// An override member is a replacement when it is a function, an array or emitter-shaped, and a
// merge over the stub's member otherwise (see sceneStub).
type Merged<Own, Override> = Override extends (...args: never[]) => unknown
  ? Override
  : Override extends readonly unknown[]
    ? Override
    : Override extends { emit: unknown; on: unknown }
      ? Override
      : Override extends object
        ? Own extends object
          ? Omit<Own, keyof Override> & Override
          : Override
        : Override;

// A SceneStub with overrides' members merged into or replacing its own, and added.
export type SceneStubWith<Overrides extends object> = {
  [K in keyof SceneStub | keyof Overrides]: K extends keyof Overrides
    ? K extends keyof SceneStub
      ? Merged<SceneStub[K], Overrides[K]>
      : Overrides[K]
    : K extends keyof SceneStub
      ? SceneStub[K]
      : never;
};

type Listener = { context: unknown; fn: (...args: never[]) => unknown; once: boolean };

// Methods are bound fields, so a test may pass one detached. Being a class instance, an emitter
// passed as an override replaces the stub's member instead of merging into it.
class Emitter {
  readonly #listeners = new Map<string | symbol, Listener[]>();

  #add = (event: string | symbol, fn: Listener["fn"], context: unknown, once: boolean) => {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), { context, fn, once }]);
    return this;
  };

  #set(event: string | symbol, listeners: Listener[]) {
    if (listeners.length === 0) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.set(event, listeners);
    }
  }

  addListener = (event: string | symbol, fn: Listener["fn"], context?: unknown) =>
    this.#add(event, fn, context, false);

  emit = (event: string | symbol, ...args: unknown[]) => {
    const current = this.#listeners.get(event) ?? [];
    this.#set(
      event,
      current.filter((listener) => !listener.once),
    );
    for (const { context, fn } of current) {
      (fn as (...args: unknown[]) => unknown).apply(context, args);
    }
    return current.length > 0;
  };

  // The events that have listeners.
  eventNames = () => [...this.#listeners.keys()];

  listenerCount = (event: string | symbol) => this.#listeners.get(event)?.length ?? 0;

  listeners = (event: string | symbol) =>
    (this.#listeners.get(event) ?? []).map(({ fn }) => fn as unknown as () => unknown);

  // As eventemitter3: without fn every listener goes; context and once narrow the match.
  off = (event: string | symbol, fn?: Listener["fn"], context?: unknown, once?: boolean) => {
    this.#set(
      event,
      (this.#listeners.get(event) ?? []).filter(
        (listener) =>
          fn !== undefined &&
          (listener.fn !== fn ||
            (context !== undefined && listener.context !== context) ||
            (once === true && !listener.once)),
      ),
    );
    return this;
  };

  on = this.addListener;

  once = (event: string | symbol, fn: Listener["fn"], context?: unknown) =>
    this.#add(event, fn, context, true);

  removeAllListeners = (event?: string | symbol) => {
    if (event === undefined) {
      this.#listeners.clear();
    } else {
      this.#listeners.delete(event);
    }
    return this;
  };

  removeListener = this.off;
}

function emitter<Extra extends object>(extra: Extra): StubEmitter & Extra {
  return Object.assign(new Emitter() as unknown as StubEmitter, extra);
}

// An object literal (prototype Object.prototype or null), as opposed to a class instance, an
// array or a function.
function isPlain(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const DEFAULT_KEY = "default";
const GAME_HEIGHT = 768;
const GAME_WIDTH = 1024;

// The setters that store one value under a property of the same name, lowercased after "set".
const SETTERS = ["Alpha", "Depth", "Text", "Tint", "Visible", "X", "Y"] as const;

// The methods that only record their calls and return the object.
const CHAINED = [
  "beginPath",
  "clearMask",
  "closePath",
  "disableInteractive",
  "fillCircle",
  "fillPath",
  "fillRect",
  "fillRoundedRect",
  "fillStyle",
  "generateTexture",
  "lineStyle",
  "lineTo",
  "moveTo",
  "play",
  "setData",
  "setFillStyle",
  "setFlipX",
  "setInteractive",
  "setLineSpacing",
  "setMask",
  "setStrokeStyle",
  "stop",
  "strokeCircle",
  "strokePath",
  "strokeRect",
  "strokeRoundedRect",
] as const;

// A Scene stand-in whose methods are made by spy, with overrides merged into its members one
// level deep. An override member that is an object literal merges into the stub's member of the
// same name when that is an object: the override's own properties, getters included, replace
// or add to the member's, and its other spies stay. Any other override value (a function, an
// array, a class instance such as an EventEmitter, another stub's emitter) or an override of a
// member the stub lacks replaces or adds the whole member. Pass the stub where code takes a
// Scene with `as unknown as Scene`. To stand in for Phaser's Scene class, a vi.mock("phaser")
// factory imports this module with `await import` and returns
// `Scene: class { constructor() { Object.assign(this, sceneStub(vi.fn)); } }`.
export function sceneStub<Overrides extends object = Record<never, never>>(
  spy: Spy,
  overrides?: Overrides,
  options: SceneStubOptions = {},
): SceneStubWith<Overrides> {
  const fake = <F>(impl?: (...args: never[]) => unknown): F => spy(impl) as unknown as F;
  const key = options.key ?? DEFAULT_KEY;
  const stub = {} as SceneStub;

  const animations = new Map<string, Animations.Animation>();
  stub.anims = {
    create: fake((config: Types.Animations.Animation) => {
      const { key: name } = config;
      if (typeof name !== "string" || name === "") {
        return false;
      }
      if (!animations.has(name)) {
        animations.set(name, config as unknown as Animations.Animation);
      }
      return animations.get(name);
    }),
    exists: fake((name: string) => options.anyAnimation === true || animations.has(name)),
    get: fake((name: string) => animations.get(name)),
  };

  const cache = (): StubCache => {
    const entries = new Map<string, unknown>();
    const self: StubCache = {
      add: fake((name: string, data: unknown) => {
        entries.set(name, data);
        return self;
      }),
      exists: fake((name: string) => entries.has(name)),
      get: fake((name: string) => entries.get(name)),
      remove: fake((name: string) => {
        entries.delete(name);
        return self;
      }),
    };
    return self;
  };
  stub.cache = { bitmapFont: cache(), json: cache() };

  const camera = (x = 0, y = 0, width = GAME_WIDTH, height = GAME_HEIGHT): StubCamera => {
    const self = {
      height,
      panEffect: { isRunning: false },
      scrollX: 0,
      scrollY: 0,
      useBounds: false,
      visible: true,
      width,
      x,
      y,
      zoom: 1,
    } as unknown as StubCamera;
    self.panEffect.reset = fake();
    const chained = () => fake(() => self);
    Object.assign(self, {
      ignore: chained(),
      pan: chained(),
      setBackgroundColor: chained(),
      setBounds: fake(() => {
        self.useBounds = true;
        return self;
      }),
      setScroll: fake((scrollX: number, scrollY: number = scrollX) => {
        self.scrollX = scrollX;
        self.scrollY = scrollY;
        return self;
      }),
      setVisible: fake((visible: boolean) => {
        self.visible = visible;
        return self;
      }),
      setZoom: fake((zoom = 1) => {
        self.zoom = zoom;
        return self;
      }),
    });
    return self;
  };
  const main = camera();
  const cameraList = [main];
  stub.cameras = {
    add: fake((x?: number, y?: number, width?: number, height?: number) => {
      const added = camera(x, y, width, height);
      cameraList.push(added);
      return added;
    }),
    cameras: cameraList,
    main,
    remove: fake((removed: StubCamera | StubCamera[]) => {
      const gone = Array.isArray(removed) ? removed : [removed];
      const before = cameraList.length;
      cameraList.splice(
        0,
        cameraList.length,
        ...cameraList.filter((entry) => !gone.includes(entry)),
      );
      return before - cameraList.length;
    }),
  } as unknown as SceneStub["cameras"];

  const displayList: StubGameObject[] = [];
  stub.children = { list: displayList };
  const takeOff = (object: StubGameObject) => {
    const index = displayList.indexOf(object);
    if (index >= 0) {
      displayList.splice(index, 1);
    }
  };

  const gameObject = (type: string, fields: Partial<StubGameObject>): StubGameObject => {
    const self = emitter({
      active: true,
      alpha: 1,
      depth: 0,
      displayHeight: 0,
      displayWidth: 0,
      font: "",
      frame: { name: "__BASE" },
      height: 0,
      list: [],
      originX: 0.5,
      originY: 0.5,
      scaleX: 1,
      scaleY: 1,
      scene: stub,
      scrollFactorX: 1,
      scrollFactorY: 1,
      text: "",
      texture: { key: "__DEFAULT" },
      tint: 0xffffff,
      type,
      visible: true,
      width: 0,
      x: 0,
      y: 0,
      ...fields,
    }) as unknown as StubGameObject;
    const members = self as unknown as Record<string, unknown>;
    for (const name of CHAINED) {
      members[name] = fake(() => self);
    }
    for (const name of SETTERS) {
      members[`set${name}`] = fake((value: never) => {
        members[name.toLowerCase()] = value;
        return self;
      });
    }
    const children = (child: StubGameObject | StubGameObject[]) =>
      Array.isArray(child) ? child : [child];
    Object.assign(self, {
      add: fake((child: StubGameObject | StubGameObject[]) => {
        for (const entry of children(child)) {
          takeOff(entry);
          self.list.push(entry);
        }
        return self;
      }),
      clear: fake(() => {
        if (type === "Container") {
          self.list.splice(0);
        }
        return self;
      }),
      clearTint: fake(() => {
        self.tint = 0xffffff;
        return self;
      }),
      destroy: fake(() => {
        self.active = false;
        self.emit("destroy", self);
        self.removeAllListeners();
        takeOff(self);
      }),
      remove: fake((child: StubGameObject | StubGameObject[], destroyChild?: boolean) => {
        for (const entry of children(child)) {
          const index = self.list.indexOf(entry);
          if (index >= 0) {
            self.list.splice(index, 1);
          }
          if (destroyChild === true) {
            entry.destroy();
          }
        }
        return self;
      }),
      setDisplaySize: fake((width: number, height: number) => {
        self.displayWidth = width;
        self.displayHeight = height;
        return self;
      }),
      setFrame: fake((frame: string | number) => {
        self.frame = { name: String(frame) };
        return self;
      }),
      setOrigin: fake((x = 0.5, y: number = x) => {
        self.originX = x;
        self.originY = y;
        return self;
      }),
      setPosition: fake((x = 0, y: number = x) => {
        self.x = x;
        self.y = y;
        return self;
      }),
      setScale: fake((x: number, y: number = x) => {
        self.scaleX = x;
        self.scaleY = y;
        return self;
      }),
      setScrollFactor: fake((x: number, y: number = x) => {
        self.scrollFactorX = x;
        self.scrollFactorY = y;
        return self;
      }),
      setSize: fake((width: number, height: number) => {
        self.width = width;
        self.height = height;
        return self;
      }),
      setText: fake((text: string | string[]) => {
        self.text = Array.isArray(text) ? text.join("\n") : text;
        return self;
      }),
      setTexture: fake((texture: string, frame?: string | number) => {
        self.texture = { key: texture };
        if (frame !== undefined) {
          self.frame = { name: String(frame) };
        }
        return self;
      }),
    });
    return self;
  };
  const added = (object: StubGameObject) => {
    displayList.push(object);
    return object;
  };
  const textured = (type: string) =>
    fake((x = 0, y = 0, texture = "__DEFAULT", frame: string | number = "__BASE") =>
      added(gameObject(type, { frame: { name: String(frame) }, texture: { key: texture }, x, y })),
    );
  stub.add = {
    bitmapText: fake((x = 0, y = 0, font = "", text: string | string[] = "") =>
      added(gameObject("BitmapText", { font, text: [text].flat().join("\n"), x, y })),
    ),
    container: fake((x = 0, y = 0, children: StubGameObject | StubGameObject[] = []) => {
      const container = added(gameObject("Container", { x, y }));
      container.add(children);
      return container;
    }),
    graphics: fake(() => added(gameObject("Graphics", {}))),
    image: textured("Image"),
    nineslice: fake(
      (
        x = 0,
        y = 0,
        texture = "__DEFAULT",
        frame: string | number = "__BASE",
        width = 0,
        height = 0,
      ) =>
        added(
          gameObject("NineSlice", {
            frame: { name: String(frame) },
            height,
            texture: { key: texture },
            width,
            x,
            y,
          }),
        ),
    ),
    rectangle: fake((x = 0, y = 0, width = 128, height = 128) =>
      added(gameObject("Rectangle", { height, width, x, y })),
    ),
    sprite: textured("Sprite"),
  } as unknown as SceneStub["add"];
  stub.make = {
    graphics: fake(() => gameObject("Graphics", {})),
  } as unknown as SceneStub["make"];

  stub.events = emitter({});

  const statuses = new Map<string, "paused" | "running">([[key, "running"]]);
  const named = (scene: unknown = key) =>
    typeof scene === "string" ? scene : String((scene as { scene?: { key?: unknown } }).scene?.key);
  const plugin = { key } as SceneStub["scene"];
  const status = (to: "paused" | "running" | undefined) =>
    fake((scene?: unknown) => {
      if (to === undefined) {
        statuses.delete(named(scene));
      } else {
        statuses.set(named(scene), to);
      }
      return plugin;
    });
  const isActive = fake<(scene?: unknown) => boolean>(
    (scene?: unknown) => statuses.get(named(scene)) === "running",
  );
  const isPaused = fake<(scene?: unknown) => boolean>(
    (scene?: unknown) => statuses.get(named(scene)) === "paused",
  );
  Object.assign(plugin, {
    get: fake((scene: unknown) => (named(scene) === key ? stub : null)),
    isActive,
    isPaused,
    launch: status("running"),
    moveAbove: fake(() => plugin),
    pause: status("paused"),
    resume: status("running"),
    setVisible: fake(() => plugin),
    start: status("running"),
    stop: status(undefined),
  });
  stub.scene = plugin;
  stub.sys = {
    isActive: fake(() => isActive(key)),
    isPaused: fake(() => isPaused(key)),
    settings: { key },
  };

  stub.game = {
    canvas: { style: {} } as HTMLCanvasElement,
    events: emitter({}),
    loop: { delta: 0, now: 0, time: 0 },
    renderer: {} as SceneStub["game"]["renderer"],
    scene: {
      getScenes: fake((active = true) =>
        !active || statuses.get(key) === "running" ? [stub] : [],
      ),
    },
  };
  stub.game.renderer.snapshotArea = fake(() => stub.game.renderer);

  const input = emitter({
    enabled: true,
    keyboard: emitter({ enabled: true }),
    manager: { pointers: [] },
  }) as unknown as SceneStub["input"];
  input.stopPropagation = fake(() => input);
  stub.input = input;

  const load = emitter({ list: new Set<Loader.File>() }) as unknown as SceneStub["load"];
  for (const name of ["bitmapFont", "image", "json", "setPath"] as const) {
    load[name] = fake(() => load);
  }
  stub.load = load;

  stub.scale = emitter({
    gameSize: { height: GAME_HEIGHT, width: GAME_WIDTH },
    height: GAME_HEIGHT,
    width: GAME_WIDTH,
  }) as unknown as SceneStub["scale"];

  stub.textures = textureManager(fake, options);

  stub.time = {
    addEvent: fake((config: Types.Time.TimerEventConfig) => timerEvent(fake, config)),
    delayedCall: fake((delay: number, callback: () => void, args?: unknown[], scope?: unknown) =>
      timerEvent(fake, { args: args ?? [], callback, callbackScope: scope, delay }),
    ),
    now: 0,
  };

  stub.tweens = {
    add: fake((config: { targets?: unknown }) => {
      const tween = emitter({ isPlaying: () => false, targets: [config.targets ?? []].flat() });
      for (const name of ["destroy", "pause", "remove", "resume", "stop"] as const) {
        Object.assign(tween, { [name]: fake(() => tween) });
      }
      return tween;
    }),
  };

  for (const [name, value] of Object.entries(overrides ?? {})) {
    const own = (stub as unknown as Record<string, unknown>)[name];
    if (isPlain(value) && typeof own === "object" && own !== null && !Array.isArray(own)) {
      Object.defineProperties(own, Object.getOwnPropertyDescriptors(value));
    } else {
      (stub as unknown as Record<string, unknown>)[name] = value;
    }
  }
  return stub as unknown as SceneStubWith<Overrides>;
}

type Fake = <F>(impl?: (...args: never[]) => unknown) => F;

function timerEvent(fake: Fake, config: Types.Time.TimerEventConfig): Time.TimerEvent {
  const event = {
    args: config.args ?? [],
    callback: config.callback,
    callbackScope: config.callbackScope,
    delay: config.delay ?? 0,
    hasDispatched: false,
    loop: config.loop ?? false,
    paused: config.paused ?? false,
    repeat: config.repeat ?? 0,
  };
  return Object.assign(event, {
    destroy: fake(),
    getProgress: fake(() => 0),
    remove: fake(() => {
      event.hasDispatched = true;
    }),
  }) as unknown as Time.TimerEvent;
}

// A canvas 2D context over a pixel buffer: putImageData writes it, getImageData reads it and
// clearRect zeroes it. The other drawing methods record their calls and draw nothing.
function canvasContext(fake: Fake, width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const imageData = (w: number, h: number) => ({
    colorSpace: "srgb",
    data: new Uint8ClampedArray(w * h * 4),
    height: h,
    width: w,
  });
  const copy = (
    from: Uint8ClampedArray,
    fromWidth: number,
    to: Uint8ClampedArray,
    toWidth: number,
    area: { fromX: number; fromY: number; h: number; toX: number; toY: number; w: number },
  ) => {
    for (let row = 0; row < area.h; row += 1) {
      for (let column = 0; column < area.w; column += 1) {
        const source = ((area.fromY + row) * fromWidth + area.fromX + column) * 4;
        const target = ((area.toY + row) * toWidth + area.toX + column) * 4;
        to.set(from.subarray(source, source + 4), target);
      }
    }
  };
  const fit = (x: number, y: number, w: number, h: number) => ({
    h: Math.max(0, Math.min(h, height - y)),
    w: Math.max(0, Math.min(w, width - x)),
  });
  const context = {
    canvas: { height, width },
    clearRect: fake((x: number, y: number, w: number, h: number) => {
      const size = fit(x, y, w, h);
      copy(new Uint8ClampedArray(size.w * size.h * 4), size.w, pixels, width, {
        ...size,
        fromX: 0,
        fromY: 0,
        toX: x,
        toY: y,
      });
    }),
    createImageData: fake(imageData),
    drawImage: fake(),
    fillRect: fake(),
    fillStyle: "#000000",
    getImageData: fake((x: number, y: number, w: number, h: number) => {
      const result = imageData(w, h);
      copy(pixels, width, result.data, w, {
        ...fit(x, y, w, h),
        fromX: x,
        fromY: y,
        toX: 0,
        toY: 0,
      });
      return result;
    }),
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    putImageData: fake((data: { data: Uint8ClampedArray; width: number }, x: number, y: number) => {
      const size = fit(x, y, data.width, data.data.length / 4 / data.width);
      copy(data.data, data.width, pixels, width, { ...size, fromX: 0, fromY: 0, toX: x, toY: y });
    }),
    restore: fake(),
    save: fake(),
  };
  return context;
}

function textureManager(fake: Fake, options: SceneStubOptions): SceneStub["textures"] {
  const missing = { key: "__MISSING", source: [] } as unknown as Textures.Texture;
  const list: Record<string, StubTexture> = {};

  // A texture whose frames start with __BASE over the whole source.
  const texture = (key: string, width: number, height: number, extra: object = {}) => {
    const frame = (name: string | number, x: number, y: number, w: number, h: number) => ({
      cutHeight: h,
      cutWidth: w,
      cutX: x,
      cutY: y,
      height: h,
      name: String(name),
      realHeight: h,
      realWidth: w,
      sourceIndex: 0,
      width: w,
    });
    const frames: Record<string, ReturnType<typeof frame>> = {
      __BASE: frame("__BASE", 0, 0, width, height),
    };
    const self = {
      firstFrame: "__BASE",
      frames,
      key,
      source: [{ height, width }],
      ...extra,
    };
    return Object.assign(self, {
      add: fake(
        (name: string | number, _source: number, x: number, y: number, w: number, h: number) => {
          frames[String(name)] = frame(name, x, y, w, h);
          return frames[String(name)];
        },
      ),
      destroy: fake(() => {
        delete list[key];
      }),
      get: fake((name?: string | number) => frames[String(name ?? "__BASE")] ?? frames.__BASE),
      getFrameNames: fake(() => Object.keys(frames).filter((name) => name !== "__BASE")),
      has: fake((name: string | number) => Object.hasOwn(frames, String(name))),
      setFilter: fake(),
    });
  };

  const register = <T extends StubTexture>(key: string, made: () => T): T | null => {
    if (Object.hasOwn(list, key)) {
      return null;
    }
    list[key] = made();
    return list[key] as T;
  };

  const manager = {} as SceneStub["textures"];
  return Object.assign(manager, {
    addImage: fake((key: string, source: { height?: number; width?: number }) =>
      register(key, () => {
        const made = texture(key, source.width ?? 0, source.height ?? 0);
        made.source[0] = { ...made.source[0], image: source } as never;
        return made as unknown as StubTexture;
      }),
    ),
    createCanvas: fake((key: string, width = 256, height = 256) =>
      register(key, () => {
        const context = canvasContext(fake, width, height);
        const made = texture(key, width, height, {
          canvas: context.canvas,
          context,
          height,
          width,
        });
        return Object.assign(made, {
          getCanvas: fake(() => context.canvas),
          getContext: fake(() => context),
          refresh: fake(() => made),
        }) as unknown as StubTexture;
      }),
    ),
    exists: fake((key: string) => options.anyTexture === true || Object.hasOwn(list, key)),
    get: fake((key: string) => (Object.hasOwn(list, key) ? list[key] : missing)),
    getFrame: fake((key: string, frame?: string | number) => {
      const listed = Object.hasOwn(list, key) ? list[key] : undefined;
      return typeof listed?.get === "function" ? listed.get(frame) : undefined;
    }),
    list,
    remove: fake((removed: string | { key: string }) => {
      delete list[typeof removed === "string" ? removed : removed.key];
      return manager;
    }),
  });
}
