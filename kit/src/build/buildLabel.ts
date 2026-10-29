// A build's label: its version and commit.
export function buildLabel(version: string, commit: string): string {
  return `v${version} · ${commit}`;
}

// This build's label, from the globals the game's bundler defines (buildInfo.d.ts).
export const BUILD_LABEL = buildLabel(__APP_VERSION__, __COMMIT__);
