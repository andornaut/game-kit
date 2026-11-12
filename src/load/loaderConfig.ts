// Phaser's game config loader: each file request times out after timeout ms and is tried
// maxRetries more times before the run counts the file as failed and carries on, so a request
// that never answers cannot hold a load run open. Pass it as the game config's loader, and
// watch every scene's loader with load/phaser/watchLoader, which applies the timeout.
export const LOADER_CONFIG = { maxRetries: 2, timeout: 30_000 } as const;

// The delays, in ms after the run that recorded them completes, of the retry rounds that queue
// failed files again: one round per entry, the first for a file's first failure.
export const RETRY_ROUNDS_MS = [15_000, 60_000, 300_000] as const;
