import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { check } from "./check.ts";
import { checkLocal } from "./check-local.ts";
import { NPM_CACHE_MISS } from "./container-check.ts";
import { git, runContainer, ScriptError } from "./runtime.ts";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  loadavg: vi.fn(() => [0, 0, 0]),
}));

vi.mock("./runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtime.ts")>()),
  runContainer: vi.fn(),
}));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "local-check-"));
  mkdirSync(join(root, "tests/container"), { recursive: true });
  copyFileSync(
    new URL("../tests/container/stock", import.meta.url),
    join(root, "tests/container/stock"),
  );
  writeFileSync(join(root, ".gitignore"), ".claude/\n");
  writeFileSync(join(root, ".nvmrc"), "v24.21.0\n");
  writeFileSync(join(root, "example.txt"), "pinned content");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Release fixture");
  git(root, "add", ".");
  git(root, "commit", "--no-verify", "--quiet", "-m", "Pinned release");
  const revision = git(root, "rev-parse", "HEAD");
  const destination = join(root, ".claude/output");
  const run = vi.mocked(runContainer);
  run.mockReset();
  vi.mocked(loadavg).mockReturnValue([0, 0, 0]);
  return { destination, revision, root, run };
}

function mountedSource(args: string[]): string {
  const mount = args.find(
    (arg) => arg.startsWith("type=bind,source=") && arg.endsWith(",readonly"),
  )!;
  return mount.slice("type=bind,source=".length, mount.indexOf(",target="));
}

it("keeps checks, cache fill and packaging proof on the pinned source even if HEAD moves", () => {
  const { destination, revision, root, run } = fixture();
  git(root, "config", "tar.umask", "0077");
  const inputs: string[] = [];
  run.mockImplementation(({ copyOut, input }, args) => {
    if (input === undefined) {
      expect(args).toContain("/bin/shellcheck");
      const file = join(mountedSource(args), "example.txt");
      expect(readFileSync(file, "utf8")).toBe("pinned content");
      expect(statSync(file).mode & 0o004).toBe(0o004);
      return;
    }
    inputs.push(execFileSync("git", ["get-tar-commit-id"], { encoding: "utf8", input }).trim());
    if (inputs.length === 1) {
      writeFileSync(join(copyOut!.to, NPM_CACHE_MISS), "");
      writeFileSync(join(root, "example.txt"), "replacement content");
      git(root, "commit", "--all", "--no-verify", "--quiet", "-m", "Moved HEAD");
      throw new ScriptError("Confirmed offline miss.");
    }
  });
  expect(() => check({}, root, destination)).toThrow(/Source changed/);
  expect(inputs).toEqual(Array<string>(4).fill(revision));
  const args = run.mock.calls.map(([, parameters]) => parameters);
  expect(args.every((parameters) => parameters.includes("--read-only"))).toBe(true);
  expect(args.map((parameters) => parameters[parameters.indexOf("--cpus") + 1])).toEqual(
    Array<string>(5).fill("4"),
  );
  expect(args.map((parameters) => parameters[parameters.indexOf("--memory") + 1])).toEqual(
    Array<string>(5).fill("4294967296"),
  );
  expect(args.map((parameters) => parameters[parameters.indexOf("--network") + 1])).toEqual([
    "none",
    "none",
    "bridge",
    "none",
    "none",
  ]);
  expect(args[4]!.slice(-3, -1)).toEqual(["artifact", revision]);
  expect(existsSync(destination)).toBe(false);
});

it("reports a non-cache failure after one offline attempt", () => {
  const { destination, root, run } = fixture();
  const installError = new ScriptError("Offline npm ci failed with EUSAGE.");
  run
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw installError;
    });
  expect(() => check({}, root, destination)).toThrow(installError);
  expect(run).toHaveBeenCalledTimes(2);
  expect(existsSync(destination)).toBe(false);
});

it("reports both source movement and a failed check", () => {
  const { destination, root, run } = fixture();
  run
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      writeFileSync(join(root, "example.txt"), "changed during verification");
      throw new ScriptError("Offline npm ci failed with EUSAGE.");
    });
  const diagnostics = [
    "Source changed during verification.",
    "The gate also failed: Offline npm ci failed with EUSAGE.",
  ].join("\n");
  expect(() => check({}, root, destination)).toThrow(diagnostics);
  expect(existsSync(destination)).toBe(false);
});

it("exports only the artifacts copied from the offline proof container", () => {
  const { destination, revision, root, run } = fixture();
  run.mockImplementation(({ copyOut }, args) => {
    if (args.includes("artifact")) {
      expect(existsSync(destination)).toBe(false);
      const release = join(copyOut!.to, "release");
      mkdirSync(release);
      writeFileSync(join(release, "game-kit-0.1.0.tgz"), "checked tarball");
      writeFileSync(join(release, "SOURCE_COMMIT"), revision);
    }
  });
  check({}, root, destination);
  expect(readFileSync(join(destination, "game-kit-0.1.0.tgz"), "utf8")).toBe("checked tarball");
  expect(readFileSync(join(destination, "SOURCE_COMMIT"), "utf8")).toBe(revision);
});

it("verifies dirty working-tree bytes and refuses to use them for a release", () => {
  const { destination, root, run } = fixture();
  writeFileSync(join(root, "example.txt"), "dirty content");
  run.mockImplementation(({ copyOut }, args) => {
    expect(readFileSync(join(mountedSource(args), "example.txt"), "utf8")).toBe("dirty content");
    expect(copyOut).toBeUndefined();
  });
  checkLocal(process.env, root, { mode: "working-tree" });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]![1].at(-1)).toBe("working-tree");
  expect(() => check({}, root, destination)).toThrow(/requires a clean checkout/);
  expect(run).toHaveBeenCalledTimes(2);
  expect(existsSync(destination)).toBe(false);
});

it.each([
  ["lint", ["shellcheck", "working-tree lint"]],
  ["test", ["working-tree test"]],
  ["build", ["working-tree build"]],
] as const)("runs only the %s part of a working-tree check", (part, launches) => {
  const { root, run } = fixture();
  checkLocal(process.env, root, { mode: "working-tree", part });
  expect(
    run.mock.calls.map(([, args]) =>
      args.includes("/bin/shellcheck") ? "shellcheck" : args.slice(-2).join(" "),
    ),
  ).toEqual(launches);
});

it("rejects oversized memory before launching a container", () => {
  const { root, run } = fixture();
  const mode = { mode: "release", releaseDirectory: undefined } as const;
  expect(() => checkLocal({ CHECK_MEMORY: "5g" }, root, mode)).toThrow(/at or below 4 GiB/);
  expect(run).not.toHaveBeenCalled();
});

it("waits for load to fall before artifact proof without repeating source checks", () => {
  const { root, run } = fixture();
  const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  vi.mocked(loadavg)
    .mockReturnValueOnce([10, 0, 0])
    .mockReturnValueOnce([10, 0, 0])
    .mockReturnValueOnce([20, 0, 0])
    .mockReturnValueOnce([15, 0, 0]);
  try {
    wait.mockImplementation(() => {
      expect(run).toHaveBeenCalledTimes(2);
      return "timed-out";
    });
    check({}, root);
    expect(wait).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2]![1].slice(-3, -2)).toEqual(["artifact"]);
  } finally {
    wait.mockRestore();
  }
});
