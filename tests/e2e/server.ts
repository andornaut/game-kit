// A static server with exact, Cloudflare-shaped response headers. Every response carries the
// HTTP/3 headers Cloudflare adds (priority, server-timing), which verified JSON must tolerate.
// It serves one deployment at a time, so switching deployments drops the previous build's files
// as a real deploy does, logs every request, and can fail chosen URLs or refuse every connection.
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

export const CLOUDFLARE_H3_HEADERS = { priority: "u=3,i", "server-timing": "cfExtPri" } as const;

const CONTENT_TYPES: Record<string, string> = {
  ".bin": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};

export interface RequestRecord {
  readonly at: number;
  readonly path: string;
  readonly status: number;
}

export interface FixtureServer {
  readonly origin: string;
  // Every request in arrival order.
  readonly log: readonly RequestRecord[];
  deploy(directory: string): void;
  // Paths answered 500 until cleared.
  readonly failing: Set<string>;
  // While refusing, every connection is destroyed unanswered.
  refuse(refusing: boolean): void;
  close(): Promise<void>;
}

function cacheControl(path: string): string {
  if (path === "/.game-kit/build.json") {
    return "no-store";
  }
  if (path.startsWith("/.game-kit/manifest-") || path.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=0, must-revalidate";
}

// The file a path names in a deployment, with /dir/ serving /dir/index.html, or undefined for a
// path outside it.
function filePath(directory: string, path: string): string | undefined {
  const relative = normalize(path.endsWith("/") ? `${path}index.html` : path);
  if (!relative.startsWith("/") || relative.includes("..")) {
    return undefined;
  }
  return join(directory, relative);
}

export async function startServer(): Promise<FixtureServer> {
  const log: RequestRecord[] = [];
  let directory: string | undefined;
  let refusing = false;
  const failing = new Set<string>();

  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    const answer = (status: number, body: Buffer | string, type: string) => {
      log.push({ at: Date.now(), path, status });
      response.writeHead(status, {
        ...CLOUDFLARE_H3_HEADERS,
        "cache-control": status === 200 ? cacheControl(path) : "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": type,
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (refusing) {
      log.push({ at: Date.now(), path, status: 0 });
      request.socket.destroy();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      answer(405, "", "text/plain; charset=utf-8");
      return;
    }
    if (failing.has(path)) {
      answer(500, "fixture failure", "text/plain; charset=utf-8");
      return;
    }
    const file = directory === undefined ? undefined : filePath(directory, path);
    if (file === undefined) {
      answer(404, "not found", "text/plain; charset=utf-8");
      return;
    }
    readFile(file).then(
      (body) => answer(200, body, CONTENT_TYPES[extname(file)] ?? "application/octet-stream"),
      () => answer(404, "not found", "text/plain; charset=utf-8"),
    );
  });
  server.keepAliveTimeout = 60_000;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    deploy(next) {
      directory = next;
    },
    failing,
    get log() {
      return log;
    },
    origin: `http://127.0.0.1:${port}`,
    refuse(next) {
      refusing = next;
      if (next) {
        server.closeAllConnections();
      }
    },
  };
}
