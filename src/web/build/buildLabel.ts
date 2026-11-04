// A build's label: its version and commit. A game passes the values its bundler defines, such as
// buildLabel(__APP_VERSION__, __COMMIT__) with web/build/vite/buildInfo's declarations.
export function buildLabel(version: string, commit: string): string {
  return `v${version} · ${commit}`;
}
