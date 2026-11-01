import { rampDown } from "../rgba.ts";

// Modal snapshots stay on the supplied palette ramps. The alpha is for an existing ink-layer
// fallback only; a palette-remapped image never receives an additional alpha shade.
export const MODAL_DIM = { fallbackAlpha: 0.72, rampSteps: 3 } as const;

export function modalDimmer(oneStep: ReadonlyMap<number, number>): (colour: number) => number {
  return rampDown(oneStep, MODAL_DIM.rampSteps);
}
