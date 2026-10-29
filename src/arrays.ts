// An array item the caller knows is in range; throws rather than returning undefined.
export function itemAt<T>(items: readonly T[], index: number): T {
  if (!(index in items)) {
    throw new RangeError(`No item at index ${index} of ${items.length}`);
  }
  return items[index] as T;
}

// Removes item, which must be in items, from items.
export function removeItem<T>(item: T, items: T[]): void {
  items.splice(items.indexOf(item), 1);
}

// The nearest index in range for an array of length items, which must be at least 1.
export function clampIndex(length: number, index: number): number {
  return Math.min(length - 1, Math.max(0, index));
}

// The index of the first item in items for which before is false, items.length if none: items
// must hold every item before is true for ahead of every item it is false for (a binary search).
export function partitionPoint<T>(before: (item: T) => boolean, items: readonly T[]): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(itemAt(items, middle))) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
