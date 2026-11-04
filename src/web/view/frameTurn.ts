// Turning the page's game frame on its side where the screen shows the other orientation than the
// game's, so a game drawn for landscape plays on a phone kept in portrait, and one drawn for
// portrait plays on a phone or tablet kept in landscape. A game imports the stylesheet for its
// orientation (frameTurnLandscapeGame.css or frameTurnPortraitGame.css), which turns <body> by
// the default turn under turnedFrameQuery before any script runs, and calls
// dom/watchFrameTurn as the page loads, which picks the turn with frameTurnFor and marks it on
// <html> as FRAME_TURN_ATTRIBUTE for the stylesheet. phaser/followFrameTurn has Phaser measure
// and map pointers through the turn.
import type { FrameTurn } from "../../view/pagePoint.ts";

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
// primary), so the game's top stays at the same edge of the device. orientationType is the
// screen's orientation type, undefined where the browser has none.
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
