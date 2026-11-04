// Check the combined, pure and Phaser type environments concurrently.
import { spawn } from "node:child_process";

import { main } from "./runtime.ts";

export const PROJECTS = [[], ["-p", "tsconfig.pure.json"], ["-p", "tsconfig.phaser.json"]];

export interface TypeCheck {
  args: string[];
  output: string;
  status: number | null;
}

/** Run `command` once per argument list at the same time, buffering each run's output. */
export function typeCheck(command: string, runs: string[][]): Promise<TypeCheck[]> {
  return Promise.all(
    runs.map(
      (args) =>
        new Promise<TypeCheck>((resolve) => {
          const chunks: Buffer[] = [];
          const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
          child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.on("error", (error) =>
            resolve({ args, output: `${error.message}\n`, status: null }),
          );
          child.on("close", (status) =>
            resolve({ args, output: Buffer.concat(chunks).toString("utf8"), status }),
          );
        }),
    ),
  );
}

/** Print each run's output as one block, in run order, and return whether all passed. */
export function report(command: string, results: TypeCheck[]): boolean {
  for (const { args, output, status } of results) {
    const verdict = status === 0 ? "passed" : `failed with status ${status}`;
    console.log(`${[command, ...args].join(" ")}: ${verdict}`);
    if (output !== "") {
      process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    }
  }
  return results.every(({ status }) => status === 0);
}

main(import.meta.url, () => {
  void typeCheck("tsc", PROJECTS).then((results) => {
    if (!report("tsc", results)) {
      process.exitCode = 1;
    }
  });
});
