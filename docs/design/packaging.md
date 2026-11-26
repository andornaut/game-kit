# Packaging

Public modules use explicit `package.json` exports under `runtime/`, `build/` or `test/`. The
package also exports `package.json` for metadata. Retiring the pre-0.47 aliases changes subpath
resolution. The canonical targets and installed-build data contracts stay the same. The
release archive holds compiled JavaScript, declarations, README, licence and `SOURCE_COMMIT`,
built offline from the committed revision. Release verification and packaging use the same pinned
source. Consumer receipts identify the checks that actually ran. See the release procedure for
combining Archie and Chibi's receipt with the separately verified Ada snapshot. Docs-only CI runs
lint and the attribution check.

Like the other kits, `make check` verifies the working tree and `make lint`, `make test` and
`make build` each run one part of it. All four go through the local check runner's containers.

Place injected dependencies and configuration before the subject. Use named fields when a
caller supplies several distinct ports or measurements. Keep short positional signatures for
familiar operations with unambiguous roles. A factory's read hook can receive the object it
reads so callers can use it during construction. Keep lifecycle and persistence details
behind the public operation that owns them.

Imports are relative, and runtime imports are acyclic: ESLint's `import-x/no-cycle` covers
`src/`, `scripts/` and `tests/`.

Reference: [Standalone verification](../../README.md#standalone-verification), [Release artifacts and consumer proof](../../README.md#release-artifacts-and-consumer-proof).

## Source bands

`src/` follows the shared source structure (game-coordinator gc-0029). Each band holds layers,
lowest first. A module imports only areas in its own layer or an earlier one, type-only imports
included, and a directory area only through its `index.ts`, which re-exports what other areas use.
Runtime imports form no cycle, so only type-only imports may form one, within a layer. An area is a
file in `src/` or `src/web/`, or the files directly in one directory; `build/` and `testing/` are
whole trees. Package exports stay the consumer surface. Tests beside their modules and
`tests/e2e/` may import any module. The kit has no page entries, so no Entries band.

| Band             | Layer | Areas, relative to `src/`                                                                                                                                |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation       | 1     | `arrays`, `assertNever`, `lines`, `mapLimit`, `maps`, `numbers`, `opaqueBounds`, `records`, `rect`, `rgba`, `units`                                      |
|                  | 2     | `random`                                                                                                                                                 |
| Model            | 1     | `ai/`, `clock/`, `terrain/`                                                                                                                              |
| Saving           | 1     | `save/`                                                                                                                                                  |
|                  | 2     | `achievements`, `achievements/`, `web/save/`                                                                                                             |
| Presentation     | 1     | `art/`, `input/`, `modalLayout`, `motion`, `progress`, `text/`, `view/`                                                                                  |
|                  | 2     | `ui/`, `web/view/`                                                                                                                                       |
| Platform         | 1     | `load/`, `progressState`, `web/buildLabel`, `web/crash/`, `web/pwa/`                                                                                     |
|                  | 2     | `web/pwa/archive/` (the build archive codec, which needs `TextEncoder`)                                                                                  |
| Engine and views | 1     | `clock/phaser/`, `input/phaser/`, `load/phaser/`, `progress/phaser/`, `text/phaser/`, `view/phaser/`, `web/input/dom/`, `web/save/dom/`, `web/view/dom/` |
|                  | 2     | `web/ui/dom/`, `web/view/phaser/`                                                                                                                        |
|                  | 3     | `web/crash/dom/`, `web/progress/dom/`                                                                                                                    |
|                  | 4     | `web/pwa/dom/`                                                                                                                                           |
| Support          | 1     | `build/` (build-time code: pure at its top, Node and Vite in `build/vite/`), `testing/`                                                                  |

Every `dom/` and `phaser/` directory is in Engine and views or Support, so only those bands
import Phaser or the DOM. Nothing in `src/` imports `scripts/` or `tests/`.

ESLint guards the table, which `SOURCE_BANDS` in `eslint.config.mjs` holds:
`import-x/no-restricted-paths` rejects an import into a later layer, past another directory
area's `index.ts`, or into `scripts/` or `tests/`, type-only imports and re-exports included. The
config refuses to load while a shipped module is in no area or in two.

## Work items

| ID      | Title                                                                        | Link                             |
| ------- | ---------------------------------------------------------------------------- | -------------------------------- |
| gk-0001 | Adopt design and work files, and run only lint for docs-only CI              | [gk-0001.md](../work/gk-0001.md) |
| gk-0003 | Release the merged task and proof worktrees                                  | [gk-0003.md](../work/gk-0003.md) |
| gk-0012 | Close the kit test-reduction target                                          | [gk-0012.md](../work/gk-0012.md) |
| gk-0014 | Publish the runtime, build and test namespaces                               | [gk-0014.md](../work/gk-0014.md) |
| gk-0033 | Bind release checks and receipts to their evidence                           | [gk-0033.md](../work/gk-0033.md) |
| gk-0035 | Use one local check runner                                                   | [gk-0035.md](../work/gk-0035.md) |
| gk-0038 | Migrate consumers and retire obsolete GameKit interfaces                     | [gk-0038.md](../work/gk-0038.md) |
| gk-0052 | Refactor for structure, encapsulation and simplicity                         | [gk-0052.md](../work/gk-0052.md) |
| gk-0057 | Retire browserLaunchContext, add kit Makefile targets and split createLaunch | [gk-0057.md](../work/gk-0057.md) |
| gk-0060 | Guard source bands with ESLint and retire the import check                   | [gk-0060.md](../work/gk-0060.md) |
| gk-0073 | Refuse imports whose specifiers are all inline types                         | [gk-0073.md](../work/gk-0073.md) |
| gk-0075 | Remove temporary package staging after each attempt                          | [gk-0075.md](../work/gk-0075.md) |
| gk-0078 | Validate browser harness mode flags                                          | [gk-0078.md](../work/gk-0078.md) |
