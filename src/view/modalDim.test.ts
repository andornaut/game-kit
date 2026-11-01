import { expect, it } from "vitest";

import { remapRgb } from "../rgba.ts";
import { modalDimmer } from "./modalDim.ts";

it("dims modal pixels through palette ramps without changing transparency or inventing colours", () => {
  const ramp = new Map([
    [0xffffff, 0xcccccc],
    [0xcccccc, 0x888888],
    [0x888888, 0x444444],
    [0x444444, 0x111111],
    [0x111111, 0x111111],
  ]);
  const pixels = new Uint8ClampedArray([0xfe, 0xfe, 0xfe, 128, 0x11, 0x11, 0x11, 255]);
  remapRgb(modalDimmer(ramp), pixels);
  expect([...pixels]).toEqual([0x44, 0x44, 0x44, 128, 0x11, 0x11, 0x11, 255]);
});
