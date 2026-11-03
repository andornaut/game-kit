import type { UiProjection, UiProjectionInput } from "./uiCommands.ts";

export function uiProjection(input: UiProjectionInput): UiProjection {
  const { captureSize, cssSize, devicePixelRatio } = input;
  if (
    ![captureSize.width, captureSize.height, cssSize.width, cssSize.height, devicePixelRatio].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new RangeError("UI projection requires positive finite dimensions and density");
  }
  const backingSize = {
    height: Math.ceil(cssSize.height * devicePixelRatio),
    width: Math.ceil(cssSize.width * devicePixelRatio),
  };
  if (![backingSize.width, backingSize.height].every(Number.isSafeInteger)) {
    throw new RangeError("UI backing dimensions exceed the integer range");
  }
  return {
    backingSize,
    captureSize: { ...captureSize },
    scaleX: backingSize.width / captureSize.width,
    scaleY: backingSize.height / captureSize.height,
  };
}
