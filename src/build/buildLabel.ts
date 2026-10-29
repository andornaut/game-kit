// A build's label: its version and commit.
export function buildLabel(version: string, commit: string): string {
  return `v${version} · ${commit}`;
}

// This build's label, as the Dev bar, the crash screen's details and Settings show it.
export const BUILD_LABEL = buildLabel(__APP_VERSION__, __COMMIT__);
