import { itemAt } from "./arrays";

// A source of floats in [0, 1). Everything random takes one, so a seed reproduces a run.
export type Random = () => number;

// mulberry32: a 32-bit generator whose sequence is fixed by its seed.
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An integer in [min, max).
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min));
}

export function randomPick<T>(random: Random, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("randomPick needs at least one item");
  }
  return itemAt(items, randomInt(random, 0, items.length));
}

// One of items, drawn with one draw, each as likely as its weight.
export function weightedPick<T>(
  random: Random,
  items: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (const [i, item] of items.entries()) {
    roll -= weights[i] ?? 0;
    if (roll < 0) {
      return item;
    }
  }
  return itemAt(items, items.length - 1);
}

// A whole number whose mean is expected: expected's whole part, and one more at its fractional
// part's chance, drawn from random only when it has one.
export function chanceRound(random: Random, expected: number): number {
  const whole = Math.floor(expected);
  const part = expected - whole;
  return whole + (part > 0 && random() < part ? 1 : 0);
}

// The items in an order drawn from random, each order as likely (Fisher-Yates).
export function shuffled<T>(random: Random, items: readonly T[]): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}

// True with the given probability: never at 0, always at 1.
export function chance(random: Random, probability: number): boolean {
  return random() < probability;
}

// FNV-1a over the name, starting from the seed mixed into the offset basis, then the murmur3
// finalizer to spread nearby inputs. Every step is a bijection on 32 bits, so for one name,
// different seeds always give different stream seeds.
export function streamSeed(seed: number, name: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

// One seed feeds several named streams, each its own generator, so an extra draw in one
// stream never shifts the sequence of another. Any name works, so a caller can split a
// stream further, such as one per zone.
export function randomStream(seed: number, name: string): Random {
  return seededRandom(streamSeed(seed, name));
}
