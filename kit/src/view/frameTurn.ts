import type { FrameTurn } from "./pagePoint";

// Turning the page's game frame on its side where the screen shows the other orientation than the
// game's, so a game drawn for landscape plays on a phone kept in portrait, and one drawn for
// portrait plays on a phone or tablet kept in landscape. A game imports the stylesheet for its
// orientation (frameTurnLandscapeGame.css or frameTurnPortraitGame.css), which turns <body> by
// the default turn under turnedFrameQuery before any script runs, and calls watchFrameTurn as the
// page loads, which picks the turn from the screen's orientation type and marks it on <html> as
// FRAME_TURN_ATTRIBUTE for the stylesheet. phaser/followFrameTurn has Phaser measure and map
// pointers through the turn.

export type GameOrientation = "landscape" | "portrait";

// The attribute on <html> naming the turn watchFrameTurn picked, "90" or "-90", absent unturned.
export const FRAME_TURN_ATTRIBUTE = "data-frame-turn";

const OTHER: Readonly<Record<GameOrientation, GameOrientation>> = {
  landscape: "portrait",
  portrait: "landscape",
};

// The media query under which a game drawn for gameOrientation is turned: a touch screen showing
// the other orientation. A desktop's window never turns, whatever its shape.
export function turnedFrameQuery(gameOrientation: GameOrientation): string {
  return `(orientation: ${OTHER[gameOrientation]}) and (pointer: coarse)`;
}

// The turn the stylesheet applies before watchFrameTurn has read the screen, and where the
// browser has no screen orientation type. A landscape game turns clockwise, read with a phone
// turned counter-clockwise onto its side from portrait; a portrait game turns counter-clockwise,
// its top at the device's own top when a device showing landscape-primary (turned
// counter-clockwise from portrait) is turned back upright.
export const DEFAULT_TURN: Readonly<Record<GameOrientation, Exclude<FrameTurn, 0>>> = {
  landscape: 90,
  portrait: -90,
};

const OPPOSITE: Readonly<Record<Exclude<FrameTurn, 0>, Exclude<FrameTurn, 0>>> = {
  [-90]: 90,
  90: -90,
};

// The turn for a game drawn for gameOrientation: 0 unturned, and turned, the default turn, or
// the opposite one on the screen's secondary orientation (the screen upside down from its
// primary), so the game's top stays at the same edge of the device.
export function frameTurnFor(
  gameOrientation: GameOrientation,
  turned: boolean,
  orientationType: string | undefined,
): FrameTurn {
  if (!turned) {
    return 0;
  }
  const turn = DEFAULT_TURN[gameOrientation];
  const secondary = orientationType === `${OTHER[gameOrientation]}-secondary`;
  return secondary ? OPPOSITE[turn] : turn;
}

// The parts of window watchFrameTurn reads, so tests can pass a fake.
export interface FrameTurnHost {
  readonly document: {
    readonly documentElement: Pick<Element, "removeAttribute" | "setAttribute">;
  };
  matchMedia(query: string): {
    addEventListener?(type: "change", listener: () => void): void;
    readonly matches: boolean;
  };
  readonly screen: {
    readonly orientation?: {
      addEventListener?(type: "change", listener: () => void): void;
      readonly type: string;
    };
  };
}

export interface FrameTurnWatch {
  // Calls listener with the new turn on each change of the turn (unturned to turned, back, or
  // the direction flipping), such as for a game to pause its play, until the returned function
  // is called.
  onChange(listener: (turn: FrameTurn) => void): () => void;
  // Reads the screen again, as a change event would: a page in the background can miss the
  // events that report a turn, so followFrameTurn rechecks on the page's return and periodically.
  recheck(): void;
  // The turn now, for followFrameTurn and a game's own pointer mapping.
  turn(): FrameTurn;
}

// Keeps FRAME_TURN_ATTRIBUTE on <html> at the turn for a game drawn for gameOrientation as the
// screen turns.
export function watchFrameTurn(
  host: FrameTurnHost,
  gameOrientation: GameOrientation,
): FrameTurnWatch {
  const turned = host.matchMedia(turnedFrameQuery(gameOrientation));
  const listeners = new Set<(turn: FrameTurn) => void>();
  let turn: FrameTurn = 0;
  const mark = () => {
    const root = host.document.documentElement;
    if (turn === 0) {
      root.removeAttribute(FRAME_TURN_ATTRIBUTE);
    } else {
      root.setAttribute(FRAME_TURN_ATTRIBUTE, String(turn));
    }
  };
  const update = () => {
    const now = frameTurnFor(gameOrientation, turned.matches, host.screen.orientation?.type);
    if (now !== turn) {
      turn = now;
      mark();
      listeners.forEach((listener) => listener(now));
    }
  };
  turn = frameTurnFor(gameOrientation, turned.matches, host.screen.orientation?.type);
  mark();
  turned.addEventListener?.("change", update);
  host.screen.orientation?.addEventListener?.("change", update);
  return {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recheck: update,
    turn: () => turn,
  };
}

// The part of screen.orientation lockGameOrientation uses. TypeScript's DOM library leaves lock
// out.
export interface OrientationLockable {
  readonly orientation?: { lock?(orientation: string): Promise<void> };
}

// Asks the browser to hold the screen in the game's orientation. Browsers allow it only in
// fullscreen or an installed app and refuse elsewhere, which needs no handling: the frame turns.
export function lockGameOrientation(
  screen: OrientationLockable,
  gameOrientation: GameOrientation,
): void {
  screen.orientation?.lock?.(gameOrientation)?.catch(() => undefined);
}
