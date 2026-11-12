// A one-shot timer, such as the browser's window or a test's fake clock: setTimeout calls handler
// once after ms and returns a handle that clearTimeout cancels.
export interface Timer {
  clearTimeout(handle: unknown): void;
  setTimeout(handler: () => void, ms: number): unknown;
}
