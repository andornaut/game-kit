// A browser-level Chrome DevTools Protocol connection that applies one set of network conditions
// to every page and service worker target, including a worker that restarts, and a CPU slowdown
// to every page. Playwright's own CDP
// sessions reach only pages, while a router worker makes its own network requests.

export interface NetworkConditions {
  readonly offline: boolean;
  // Added to each request, in milliseconds.
  readonly latency: number;
  // Bytes per second.
  readonly downloadThroughput: number;
  readonly uploadThroughput: number;
}

interface Message {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
  readonly sessionId?: string;
}

interface TargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
}

const THROTTLED_TYPES = new Set(["page", "service_worker"]);

export interface BrowserNetwork {
  // Applies conditions to every current and later target, and resolves once current ones have them.
  setConditions(conditions: NetworkConditions): Promise<void>;
  // Stops every service worker, as chrome://serviceworker-internals does.
  stopServiceWorkers(): Promise<void>;
  // How many targets of each type have the current conditions.
  throttled(): Record<string, number>;
  close(): void;
}

export async function connectBrowserNetwork(
  options: { readonly port: number; readonly cpuSlowdown: number },
  conditions: NetworkConditions,
): Promise<BrowserNetwork> {
  const { cpuSlowdown, port } = options;
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), {
      once: true,
    });
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: Message) => void; reject: (e: Error) => void }
  >();
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Message>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { reject, resolve });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  let current = conditions;
  // Attached session ids by target id, with the target type.
  const sessions = new Map<string, { sessionId: string; type: string }>();
  const attaching = new Set<string>();

  const apply = async (sessionId: string) => {
    await send("Network.enable", {}, sessionId);
    await send("Network.emulateNetworkConditions", { ...current }, sessionId);
  };
  const slow = (sessionId: string) =>
    send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown }, sessionId);

  const attach = async (target: TargetInfo) => {
    if (!THROTTLED_TYPES.has(target.type) || sessions.has(target.targetId)) {
      return;
    }
    if (attaching.has(target.targetId)) {
      return;
    }
    attaching.add(target.targetId);
    try {
      const reply = await send("Target.attachToTarget", {
        flatten: true,
        targetId: target.targetId,
      });
      const sessionId = reply.result?.sessionId as string | undefined;
      if (sessionId !== undefined) {
        sessions.set(target.targetId, { sessionId, type: target.type });
        await apply(sessionId);
        if (target.type === "page") {
          await slow(sessionId);
        }
      }
    } catch {
      // A target that closed while attaching needs no conditions.
    } finally {
      attaching.delete(target.targetId);
    }
  };

  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as Message;
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter?.reject(new Error(message.error.message));
      } else {
        waiter?.resolve(message);
      }
      return;
    }
    if (
      message.method === "Target.targetCreated" ||
      message.method === "Target.targetInfoChanged"
    ) {
      void attach(message.params?.targetInfo as TargetInfo);
    } else if (message.method === "Target.detachedFromTarget") {
      for (const [targetId, session] of sessions) {
        if (session.sessionId === message.params?.sessionId) {
          sessions.delete(targetId);
        }
      }
    }
  });

  await send("Target.setDiscoverTargets", { discover: true });
  const { result } = await send("Target.getTargets");
  await Promise.all(((result?.targetInfos ?? []) as TargetInfo[]).map(attach));

  return {
    close: () => socket.close(),
    async setConditions(next) {
      current = next;
      await Promise.all(
        [...sessions.values()].map(({ sessionId }) => apply(sessionId).catch(() => undefined)),
      );
    },
    async stopServiceWorkers() {
      const page = [...sessions.values()].find((session) => session.type === "page");
      if (page === undefined) {
        throw new Error("No page target to stop service workers from");
      }
      await send("ServiceWorker.enable", {}, page.sessionId);
      await send("ServiceWorker.stopAllWorkers", {}, page.sessionId);
    },
    throttled() {
      const counts: Record<string, number> = {};
      for (const { type } of sessions.values()) {
        counts[type] = (counts[type] ?? 0) + 1;
      }
      return counts;
    },
  };
}
