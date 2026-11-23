// An installed legacy router has the same script URL as its replacement.
// Ask the controlling worker before making an archive-only build active.
export const BUILD_ARCHIVE_ROUTER_PROBE = "game-kit:archive-router:1";
export const BUILD_GROUP_ROUTER_PROBE = "game-kit:group-router:1";

interface ProbeContext {
  readonly clearTimeout: (handle: unknown) => void;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly signal: AbortSignal;
}

export function supportsBuildArchive(
  context: ProbeContext,
  timeoutMs: number,
  controller: { postMessage(message: string, transfer: MessagePort[]): void },
  probe: string = BUILD_ARCHIVE_ROUTER_PROBE,
): Promise<boolean> {
  const { clearTimeout, setTimeout, signal } = context;
  if (signal.aborted) {
    return Promise.resolve(false);
  }
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve) => {
    const finish = (supported: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      port1.close();
      resolve(supported);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(aborted, timeoutMs);
    signal.addEventListener("abort", aborted, { once: true });
    port1.onmessage = (event) => finish(event.data === probe);
    try {
      controller.postMessage(probe, [port2]);
    } catch {
      port2.close();
      finish(false);
    }
  });
}
