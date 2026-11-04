// Applying the page frame's turn (../frameTurn.ts) to the page: marking it on <html> for the
// turned-frame stylesheet as the screen turns, and asking the browser to hold the game's
// orientation.
import type { FrameTurn } from "../../../view/pagePoint.ts";
import {
  FRAME_TURN_ATTRIBUTE,
  frameTurnFor,
  type GameOrientation,
  turnedFrameQuery,
} from "../frameTurn.ts";

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

// Keeps FRAME_TURN_ATTRIBUTE on host's <html> at the turn for a game drawn for gameOrientation as
// the screen turns. host is the page's window.
export function watchFrameTurn(
  gameOrientation: GameOrientation,
  host: FrameTurnHost,
): FrameTurnWatch {
  const turned = host.matchMedia(turnedFrameQuery(gameOrientation));
  const listeners = new Set<(turn: FrameTurn) => void>();
  const read = () => frameTurnFor(gameOrientation, turned.matches, host.screen.orientation?.type);
  let turn = read();
  const mark = () => {
    const root = host.document.documentElement;
    if (turn === 0) {
      root.removeAttribute(FRAME_TURN_ATTRIBUTE);
    } else {
      root.setAttribute(FRAME_TURN_ATTRIBUTE, String(turn));
    }
  };
  const update = () => {
    const now = read();
    if (now !== turn) {
      turn = now;
      mark();
      listeners.forEach((listener) => listener(now));
    }
  };
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

// Asks the browser to hold screen in the game's orientation. Browsers allow it only in
// fullscreen or an installed app and refuse elsewhere, which needs no handling: the frame turns.
export function lockGameOrientation(
  gameOrientation: GameOrientation,
  screen: OrientationLockable,
): void {
  screen.orientation?.lock?.(gameOrientation)?.catch(() => undefined);
}
