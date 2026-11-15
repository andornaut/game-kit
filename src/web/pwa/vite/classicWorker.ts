import { BuildEnvironment, createBuilder, parseSync, type ResolvedConfig } from "vite";

export function assertClassicWorker(fileName: string, code: string): void {
  const parsed = parseSync(fileName, code, { sourceType: "script" });
  if (parsed.errors.length > 0) {
    throw new Error(`precache: ${fileName} must be a self-contained classic script`);
  }
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    const item = node as Record<string, unknown>;
    const callee = item.callee as Record<string, unknown> | undefined;
    const property = callee?.property as Record<string, unknown> | undefined;
    const importsScript =
      callee?.name === "importScripts" ||
      property?.name === "importScripts" ||
      property?.value === "importScripts";
    if (item.type === "ImportExpression" || (item.type === "CallExpression" && importsScript)) {
      throw new Error(`precache: ${fileName} must not import other scripts`);
    }
    for (const value of Object.values(item)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value !== null && typeof value === "object") {
        visit(value);
      }
    }
  };
  visit(parsed.program);
}

export async function classicWorker(
  config: ResolvedConfig,
  fileName: string,
  source: string,
): Promise<{ readonly code: string; readonly watchFiles: readonly string[] }> {
  const builder = await createBuilder(
    {
      build: {
        createEnvironment: async () => {
          // Vite's worker pipeline creates fresh worker plugins without page build hooks.
          const worker = await config.worker.plugins([source]);
          const options = {
            ...worker.build,
            copyPublicDir: false,
            emptyOutDir: false,
            lib: false as const,
            manifest: false as const,
            modulePreload: false as const,
            rolldownOptions: {
              ...config.worker.rolldownOptions,
              input: source,
              output: { codeSplitting: false, entryFileNames: fileName, format: "iife" as const },
              preserveEntrySignatures: false as const,
            },
            sourcemap: worker.build.sourcemap ? ("inline" as const) : (false as const),
            ssr: false as const,
            ssrManifest: false as const,
            watch: null,
            write: false,
          };
          return new BuildEnvironment("client", {
            ...worker,
            build: options,
            environments: {
              ...worker.environments,
              client: { ...worker.environments.client!, build: options },
            },
            input: source,
          });
        },
        write: false,
      },
      configFile: false,
      envFile: false,
      logLevel: config.logLevel ?? "info",
      root: config.root,
    },
    true,
  );
  const result = await builder.build(builder.environments.client!);
  if (!("output" in result) || result.output.length !== 1) {
    throw new Error("precache: worker must emit exactly one self-contained classic script");
  }
  const chunk = result.output[0]!;
  if (chunk.type !== "chunk" || chunk.imports.length > 0 || chunk.dynamicImports.length > 0) {
    throw new Error("precache: worker must not have split or external dependencies");
  }
  assertClassicWorker(fileName, chunk.code);
  return {
    code: chunk.code,
    watchFiles: Object.keys(chunk.modules).filter((id) => !id.startsWith("\0")),
  };
}
