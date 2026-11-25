// How many files build-time code reads at once: each read holds a file descriptor until it
// finishes, and a build host's descriptor limit can be as low as 256.
export const READ_LIMIT = 16;

// Maps each item with map, running at most limit calls at a time, and resolves to the results
// in item order. Rejects with the first failure and starts no further calls after it.
export async function mapLimit<T, R>(
  limit: number,
  map: (item: T, index: number) => Promise<R>,
  items: readonly T[],
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapLimit needs a positive integer limit, not ${limit}`);
  }
  const results = new Array<R>(items.length);
  // One index sequence shared by every worker, so each item is mapped once.
  const pending = items.keys();
  let failed = false;
  // Records a failure as it happens, so no worker starts another call after it.
  const run = (index: number): Promise<void> =>
    map(items[index] as T, index).then(
      (result) => {
        results[index] = result;
      },
      (error: unknown) => {
        failed = true;
        throw error;
      },
    );
  const worker = async (): Promise<void> => {
    for (const index of pending) {
      if (failed) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await run(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
