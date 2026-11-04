import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { report, typeCheck } from "./typecheck.ts";

/** A Node script that marks itself started, then waits for its peer, which only overlap allows. */
function rendezvous(directory: string, self: string, peer: string, finish: string): string[] {
  const script = [
    'const { existsSync, writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(join(directory, self))}, "");`,
    "const deadline = Date.now() + 10000;",
    "const wait = () => {",
    `  if (existsSync(${JSON.stringify(join(directory, peer))})) { ${finish} }`,
    "  else if (Date.now() > deadline) { process.exit(3); }",
    "  else { setTimeout(wait, 10); }",
    "};",
    "wait();",
  ].join("\n");
  return ["-e", script];
}

it("runs every check concurrently and keeps each one's output whole", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kit-typecheck-"));
  const results = await typeCheck(process.execPath, [
    rendezvous(directory, "a", "b", 'console.log("first");'),
    rendezvous(directory, "b", "a", 'console.error("second"); process.exit(2);'),
  ]);
  expect(results.map(({ output, status }) => ({ output, status }))).toEqual([
    { output: "first\n", status: 0 },
    { output: "second\n", status: 2 },
  ]);
});

it("reports a command that cannot start as a failure", async () => {
  const [result] = await typeCheck("/nonexistent/tsc", [[]]);
  expect(result?.status).toBeNull();
  expect(result?.output).toContain("ENOENT");
});

it("prints each result in run order and fails when any run failed", () => {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
  const write = vi.spyOn(process.stdout, "write").mockImplementation((text) => {
    lines.push(String(text));
    return true;
  });
  try {
    expect(
      report("tsc", [
        { args: [], output: "", status: 0 },
        { args: ["-p", "tsconfig.pure.json"], output: "error TS1", status: 2 },
      ]),
    ).toBe(false);
    expect(report("tsc", [{ args: [], output: "", status: 0 }])).toBe(true);
  } finally {
    log.mockRestore();
    write.mockRestore();
  }
  expect(lines).toEqual([
    "tsc: passed",
    "tsc -p tsconfig.pure.json: failed with status 2",
    "error TS1\n",
    "tsc: passed",
  ]);
});
