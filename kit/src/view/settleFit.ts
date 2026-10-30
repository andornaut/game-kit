// Refitting until the page's size settles: a browser can report the visible area, the play area
// and the frame's turn before it has finished laying the page out after the app returns from the
// background or the phone turns, so one refit on the signal can use stale sizes.

// Most frames settleFit keeps refitting for, should the size never come to rest.
export const SETTLE_FRAMES = 30;

// Refits now, then once each animation frame while measure gives a different answer from the
// frame before, stopping after two equal measurements in a row or SETTLE_FRAMES frames.
// measure names the sizes that matter (the visible area, the play area and the turn) as one
// string. Returns a function that stops it early.
export function settleFit(
  requestFrame: (callback: () => void) => unknown,
  measure: () => string,
  refit: () => void,
): () => void {
  let stopped = false;
  let frames = 0;
  let last = measure();
  refit();
  const step = () => {
    if (stopped) {
      return;
    }
    frames += 1;
    const now = measure();
    if (now === last || frames >= SETTLE_FRAMES) {
      return;
    }
    last = now;
    refit();
    requestFrame(step);
  };
  requestFrame(step);
  return () => {
    stopped = true;
  };
}
