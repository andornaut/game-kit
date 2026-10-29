declare const unit: unique symbol;
// A number branded with its unit's name, so values of different units do not mix. A game brands
// its own units with it.
export type Unit<Name extends string> = number & { readonly [unit]: Name };

export type Multiplier = Unit<"Multiplier">;
// Pixels, or pixels per second for a speed.
export type Pixels = Unit<"Pixels">;
// A chance from 0 to 1.
export type Probability = Unit<"Probability">;
export type Seconds = Unit<"Seconds">;

export function multiplier(value: number): Multiplier {
  return value as Multiplier;
}

export function pixels(value: number): Pixels {
  return value as Pixels;
}

export function probability(value: number): Probability {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`A probability must be from 0 to 1, not ${value}`);
  }
  return value as Probability;
}

export function seconds(value: number): Seconds {
  return value as Seconds;
}
