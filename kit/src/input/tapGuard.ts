// An overlay that breaks into play (a level-up screen, a choice card) takes no tap, press or key
// until guardMs has passed since the first frame it is drawn on, so a tap meant for the game
// under it never answers it. phaser/guardSceneInput applies it to a scene.

// Whether an overlay first drawn at drawnMs, or null while not yet drawn, takes input at nowMs.
export function guardPassed(guardMs: number, drawnMs: number | null, nowMs: number): boolean {
  return drawnMs !== null && nowMs - drawnMs >= guardMs;
}
