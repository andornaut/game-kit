import {
  DOWNLOAD_PROGRESS_MESSAGE,
  type DownloadProgress,
  isDownloadProgress,
} from "../downloadProgress.ts";
import type { ServiceWorkerLike } from "./updateReady.ts";

// The port addresses one specific installation. Reconnecting gets its current snapshot, not
// another build's global broadcast. Older workers leave their bar indeterminate.
export function watchDownloadProgress(
  report: (snapshot: DownloadProgress) => void,
  worker: ServiceWorkerLike,
): () => void {
  const channel = new MessageChannel();
  let disposed = false;
  let operationId: string | undefined;
  let version: string | undefined;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      channel.port1.onmessage = null;
      channel.port1.onmessageerror = null;
      channel.port1.close();
      channel.port2.close();
    }
  };
  channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (disposed || !isDownloadProgress(data)) {
      return;
    }
    if (
      operationId !== undefined &&
      (operationId !== data.operationId || version !== data.version)
    ) {
      return;
    }
    operationId = data.operationId;
    version = data.version;
    try {
      report(data);
    } catch (error) {
      console.error("Download progress callback failed.", error);
    }
    if (data.phase === "complete" || data.phase === "failed") {
      dispose();
    }
  };
  channel.port1.onmessageerror = dispose;
  try {
    worker.postMessage({ type: DOWNLOAD_PROGRESS_MESSAGE }, [channel.port2]);
  } catch {
    dispose();
  }
  return dispose;
}
