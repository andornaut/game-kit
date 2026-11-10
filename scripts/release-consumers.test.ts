import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import {
  adoptArtifact,
  GAME_KIT_TEST_SCRIPT,
  requireGameKitTest,
  unsafeArchiveModes,
  unsafeArchivePaths,
} from "./release-consumer-job.ts";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-release-version-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, ".claude/cache"), { recursive: true });
  for (const file of [
    "check-release-consumers.ts",
    "pack.ts",
    "runtime.ts",
    "source-fingerprint.ts",
  ]) {
    copyFileSync(join(source, "scripts", file), join(root, "scripts", file));
  }
  writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
  writeFileSync(join(root, ".gitignore"), ".claude/\nbin/\n");
  // Record only the job container's arguments; every other Docker command succeeds silently.
  writeFileSync(
    join(root, "bin/docker"),
    '#!/bin/sh\nif [ "$1" = create ]; then printf "%s\\n" "$@" > "$CAPTURE"; echo fixture; fi\n',
    { mode: 0o755 },
  );
  git("init", "--quiet");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "release@example.invalid");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "0.1.0" }));
  git("add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture source");
  const revision = git("rev-parse", "HEAD");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "0.3.0" }));
  git("add", "package.json");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture head");
  const artifact = join(root, ".claude/release.tgz");
  writeFileSync(artifact, "opaque artifact, not a trusted version source");
  const hash = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  const capture = join(root, ".claude/captured");
  const guard = join(root, ".claude/cache-guard.mjs");
  writeFileSync(
    guard,
    [
      `import { checkReleaseConsumers } from ${JSON.stringify(join(root, "scripts/check-release-consumers.ts"))};`,
      "const env = {...process.env};",
      "Object.defineProperty(env, process.env.FORBIDDEN_CACHE, {get(){throw new Error('Unselected cache read');}});",
      "checkReleaseConsumers(env, process.cwd(), process.argv.slice(2));",
    ].join("\n"),
  );
  const caches = {
    GAME_KIT_ARCHIE_CACHE: join(root, ".claude/cache"),
    GAME_KIT_CHIBI_CACHE: join(root, ".claude/cache"),
  };
  const run = (
    args = [artifact, hash, revision, root, revision, root, revision],
    cacheEnv: Partial<typeof caches> = caches,
    forbiddenCache?: string,
  ) =>
    spawnSync(
      process.execPath,
      [forbiddenCache ? guard : join(root, "scripts/check-release-consumers.ts"), ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GAME_KIT_ARCHIE_CACHE: undefined,
          GAME_KIT_CHIBI_CACHE: undefined,
          ...cacheEnv,
          CAPTURE: capture,
          FORBIDDEN_CACHE: forbiddenCache,
          // The fake Docker runs nothing heavy, so the result must not depend on host load.
          GAME_KIT_LOAD: "0",
          PATH: `${root}/bin:${process.env.PATH}`,
        },
      },
    );
  return { artifact, hash, capture, revision, root, run };
}

it("passes the version from the pinned source rather than current HEAD or artifact", () => {
  const { capture, revision, root, run } = fixture("@andornaut/game-kit");
  expect(run().status).toBe(0);
  const args = readFileSync(capture, "utf8").trim().split("\n");
  expect(args.slice(-4)).toEqual([revision, "0.1.0", revision, revision]);
  expect(args).toContain("--network");
  expect(args.some((arg) => arg.includes("target=/repos/archie.git"))).toBe(true);
  expect(args.some((arg) => arg.includes("target=/repos/chibi.git"))).toBe(true);
  expect(
    args.filter((arg) => arg.startsWith("type=bind")).every((arg) => arg.endsWith(",readonly")),
  ).toBe(true);
  const [evidence] = readdirSync(join(root, ".claude")).filter((name) =>
    name.startsWith("release-consumers."),
  );
  expect(readFileSync(join(root, ".claude", String(evidence), "RESULT"), "utf8")).toBe("PASS\n");
});

it("rejects a source revision belonging to another package before launching Docker", () => {
  const { capture, run } = fixture("another-package");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Source revision is not @andornaut/game-kit");
  expect(() => readFileSync(capture)).toThrow();
});

it("validates argument count and checksum shape", () => {
  const { revision, root, run } = fixture("@andornaut/game-kit");
  expect(run([]).status).toBe(2);
  const artifact = join(root, ".claude/release.tgz");
  const result = run([artifact, "ABC", revision, root, revision, root, revision]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("64 lowercase hex digits");
});

it.each<[string, Record<string, string>]>([
  ["no caches", {}],
  ["only the Archie cache", { GAME_KIT_ARCHIE_CACHE: "/cache" }],
  ["only the Chibi cache", { GAME_KIT_CHIBI_CACHE: "/cache" }],
])("requires both game caches before launching Docker: %s", (_, cacheEnv) => {
  const { capture, run } = fixture("@andornaut/game-kit");
  const result = run(undefined, cacheEnv);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("GAME_KIT_ARCHIE_CACHE and GAME_KIT_CHIBI_CACHE must name");
  expect(() => readFileSync(capture)).toThrow();
});

it.each([
  ["archie", /Archie snapshot defines no "test:game-kit" npm script/],
  ["chibi", /Chibi snapshot defines no "test:game-kit" npm script/],
] as const)("requires the %s snapshot to define its kit test script", (game, missing) => {
  const root = mkdtempSync(join(tmpdir(), "kit-consumer-test-script-"));
  const manifest = (scripts: Record<string, string>) =>
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
  manifest({ test: "vitest run" });
  expect(() => requireGameKitTest(game, root)).toThrow(missing);
  manifest({ [GAME_KIT_TEST_SCRIPT]: "vitest run src/a.test.ts" });
  expect(() => requireGameKitTest(game, root)).not.toThrow();
});

it("refuses archive members outside package/ or with parent segments", () => {
  const listing = ["package/", "package/a.js", "other/b.js", "package/../c", "package/x/.."];
  expect(unsafeArchivePaths(`${listing.join("\n")}\n`)).toEqual(listing.slice(2));
});

it("refuses archive links and special files", () => {
  const modes = ["drwxr-xr-x 0/0 0 package/", "-rw-r--r-- 0/0 1 package/a", "lrwxrwxrwx 0/0 0 x"];
  expect(unsafeArchiveModes(modes.join("\n"))).toEqual([modes[2]]);
});

it("adapts only the declared kit dependency to the exact tarball", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-consumer-manifest-"));
  const manifest = { dependencies: { "@andornaut/game-kit": "1.0.0", other: "2.0.0" }, name: "x" };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  adoptArtifact("/assets/release.tgz", root);
  expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).toEqual({
    ...manifest,
    dependencies: { "@andornaut/game-kit": "file:/assets/release.tgz", other: "2.0.0" },
  });
  writeFileSync(join(root, "package.json"), "{}");
  expect(() => adoptArtifact("/assets/release.tgz", root)).toThrow(/must declare game-kit/);
});

it.each(["chibi", "archie"] as const)(
  "isolates the %s CLI without reading or mounting the omitted game cache",
  (game) => {
    const { artifact, capture, hash, revision, root, run } = fixture("@andornaut/game-kit");
    const other = game === "chibi" ? "archie" : "chibi";
    const selectedCache = game === "chibi" ? "GAME_KIT_CHIBI_CACHE" : "GAME_KIT_ARCHIE_CACHE";
    const forbiddenCache = game === "chibi" ? "GAME_KIT_ARCHIE_CACHE" : "GAME_KIT_CHIBI_CACHE";
    const result = run(
      ["--game", game, artifact, hash, revision, root, revision],
      {
        [selectedCache]: join(root, ".claude/cache"),
        [forbiddenCache]: "/unselected-must-not-resolve",
      },
      forbiddenCache,
    );
    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(capture, "utf8").trim().split("\n");
    expect(args.slice(-6)).toEqual(["--game", game, hash, revision, "0.1.0", revision]);
    expect(args.some((arg) => arg.includes(`/repos/${game}.git`))).toBe(true);
    expect(
      args.some((arg) => arg.includes(`/repos/${other}.git`) || arg.includes(`/caches/${other}`)),
    ).toBe(false);
    expect(args.some((arg) => arg.includes("unselected-must-not-resolve"))).toBe(false);
    const [name] = readdirSync(join(root, ".claude")).filter((name) =>
      name.startsWith("release-consumers."),
    );
    const output = join(root, ".claude", name!);
    expect(readFileSync(join(output, "RESULT"), "utf8")).toBe(
      `PARTIAL PASS: incomplete-release-proof; selected_games=${game}\n`,
    );
    const revisions = readFileSync(join(output, "revisions.txt"), "utf8");
    expect(revisions).toContain(`selected_games=${game}\n`);
    expect(revisions).toContain("scope=incomplete-release-proof");
    expect(revisions).not.toContain(`\n${other}=`);
  },
);

it("rejects unsupported single-game selection before resolving inputs or launching Docker", () => {
  const { capture, run } = fixture("@andornaut/game-kit");
  expect(run(["--game", "both", "/not-read", "bad", "bad", "/not-read", "bad"]).status).toBe(2);
  expect(() => readFileSync(capture)).toThrow();
});

it("does not turn a failed selected container into a partial pass", () => {
  const { artifact, hash, revision, root, run } = fixture("@andornaut/game-kit");
  writeFileSync(
    join(root, "bin/docker"),
    '#!/bin/sh\nif [ "$1" = create ]; then echo fixture; fi\nif [ "$1" = start ]; then exit 7; fi\n',
    { mode: 0o755 },
  );
  const result = run(["--game", "chibi", artifact, hash, revision, root, revision], {
    GAME_KIT_CHIBI_CACHE: join(root, ".claude/cache"),
  });
  expect(result.status).toBe(1);
  const [name] = readdirSync(join(root, ".claude")).filter((name) =>
    name.startsWith("release-consumers."),
  );
  expect(readFileSync(join(root, ".claude", name!, "RESULT"), "utf8")).toBe("FAIL\n");
});

it.each([
  ["both", false],
  ["chibi", false],
  ["archie", false],
  ["chibi", true],
  ["invalid", false],
] as const)("runs only selected job invocations for %s (failure: %s)", async (mode, fail) => {
  const fs = await import("node:fs");
  const cp = await import("node:child_process");
  const calls: { command: string; args: readonly string[]; cwd: string }[] = [];
  const bytes = "fixture artifact";
  const hash = createHash("sha256").update(bytes).digest("hex");
  vi.resetModules();
  vi.doMock("node:fs", () => ({
    ...fs,
    readFileSync: (path: string, ...args: unknown[]) => {
      if (path === "/harness/.nvmrc") {
        return "24.21.0";
      }
      if (path === "/assets/release.tgz") {
        return bytes;
      }
      if (path.startsWith("/tmp/work/") && path.endsWith("/package.json")) {
        return JSON.stringify({
          dependencies: { "@andornaut/game-kit": "0.19.0" },
          scripts: { "test:game-kit": "vitest run" },
        });
      }
      return Reflect.apply(fs.readFileSync, undefined, [path, ...args]);
    },
  }));
  vi.doMock("node:child_process", () => ({
    ...cp,
    execFileSync: (_command: string, args: readonly string[]) =>
      args[0] === "-tzf"
        ? "package/\n"
        : args[0] === "-tvzf"
          ? "drwxr-xr-x 0/0 0 package/\n"
          : Buffer.from(""),
    spawnSync: (command: string, args: readonly string[], options: { cwd: string }) => {
      calls.push({ args, command, cwd: options.cwd });
      return { status: fail && command === "npm" && args[0] === "ci" ? 1 : 0 };
    },
  }));
  try {
    const { releaseConsumerJob } = await import("./release-consumer-job.ts");
    const args =
      mode === "both"
        ? [hash, "source", "0.20.0", "archie-ref", "chibi-ref"]
        : ["--game", mode, hash, "source", "0.20.0", "selected-ref"];
    if (fail || mode === "invalid") {
      expect(() => releaseConsumerJob(args)).toThrow();
    } else {
      expect(() => releaseConsumerJob(args)).not.toThrow();
    }
    const expected = mode === "both" ? ["archie", "chibi"] : mode === "invalid" ? [] : [mode];
    expect([...new Set(calls.map((call) => call.cwd))]).toEqual(
      expected.map((game) => `/tmp/work/${game}`),
    );
    for (const game of expected) {
      expect(
        calls.some(
          (call) =>
            call.cwd === `/tmp/work/${game}` && call.command === "npm" && call.args[0] === "ci",
        ),
      ).toBe(true);
    }
    if (mode !== "invalid") {
      const scope = JSON.parse(fs.readFileSync("/tmp/scratch/scope.json", "utf8"));
      expect(scope).toEqual({
        scope: mode === "both" ? "complete-release-proof" : "incomplete-release-proof",
        selectedGames: expected,
      });
    }
  } finally {
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    vi.resetModules();
  }
});
