# Packaging

Public modules use explicit `package.json` exports under `runtime/`, `build/` or `test/`. The
package also exports `package.json` for metadata. Retirement of the pre-0.47 aliases changed
subpath resolution while preserving canonical targets and installed-build data contracts. See the
[namespace migration](../using-game-kit.md#api-namespaces-and-migration).

The release archive holds compiled JavaScript, declarations, README, licence and `SOURCE_COMMIT`,
built offline from the committed revision. Release verification and packaging use the same pinned
source. Consumer receipts identify the checks that actually ran. See the release procedure for
combining Archie and Chibi's receipt with the separately verified Ada snapshot.

When the changed paths are exclusively under `docs/`, CI skips browser tests, unit tests and
release packaging. Lint and the attribution check still run. Root README edits run the full
workflow.

Like the other kits, `make check` verifies the working tree and `make lint`, `make test` and
`make build` each run one part of it. All four go through the local check runner's containers.

Place injected dependencies and configuration before the subject. Use named fields when a
caller supplies several distinct ports or measurements. Keep short positional signatures for
familiar operations with unambiguous roles. A factory's read hook can receive the object it
reads so callers can use it during construction. Keep lifecycle and persistence details
behind the public operation that owns them.

Imports are relative. ESLint's `import-x/no-cycle` checks runtime imports in `src/`,
`scripts/` and `tests/`. Use `import type` for an entirely type-only import. Inline type
specifiers alone can leave a runtime module load under `verbatimModuleSyntax`.

See [Standalone verification](../development.md#standalone-verification), [Release artifacts and consumer proof](../development.md#release-artifacts-and-consumer-proof).

## Source bands

`src/` follows the shared source structure (game-coordinator gc-0029). Each band holds layers,
lowest first. A module may import from its own layer or an earlier one, including type-only
imports. UI and browser PWA areas expose named modules directly to other areas. Other directory
areas expose their existing `index.ts`. Runtime imports are acyclic. An area is a source file,
the files directly in a directory, or a whole tree for `build/` and `testing/`. Tests beside
their modules and `tests/e2e/` may import any module. The kit has no page entries.

Package exports keep stable consumer subpaths independently of these source paths. The
`dom/`, `phaser/` and `vite/` directory segments set the environment for their descendants.
The Vite build groups `precache/` for offline distribution and `phaserBuild/` for renderer
bundling and feature analysis. Shared build configuration and metadata stay in `build/vite/`.

| Band             | Layer | Areas, relative to `src/`                                                                                                                                |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation       | 1     | `arrays`, `assertNever`, `lines`, `mapLimit`, `maps`, `numbers`, `opaqueBounds`, `records`, `rect`, `rgba`, `units`                                      |
|                  | 2     | `random`                                                                                                                                                 |
| Model            | 1     | `ai/`, `clock/`, `terrain/`                                                                                                                              |
| Saving           | 1     | `save/`                                                                                                                                                  |
|                  | 2     | `achievements`, `achievements/`, `web/save/`                                                                                                             |
| Presentation     | 1     | `art/`, `input/`, `modalLayout`, `motion`, `progress`, `text/`, `view/`                                                                                  |
|                  | 2     | `ui/`, `web/view/`                                                                                                                                       |
|                  | 3     | `ui/actions/`                                                                                                                                            |
|                  | 4     | `ui/layout/`                                                                                                                                             |
| Platform         | 1     | `load/`, `progressState`, `web/buildLabel`, `web/crash/`, `web/pwa/`                                                                                     |
|                  | 2     | `web/pwa/archive/` (the build archive codec, which needs `TextEncoder`)                                                                                  |
| Engine and views | 1     | `clock/phaser/`, `input/phaser/`, `load/phaser/`, `progress/phaser/`, `text/phaser/`, `view/phaser/`, `web/input/dom/`, `web/save/dom/`, `web/view/dom/` |
|                  | 2     | `web/ui/dom/`, `web/view/phaser/`, `web/pwa/dom/`, `web/pwa/dom/storage/`                                                                                |
|                  | 3     | `web/ui/dom/controls/`, `web/ui/dom/layout/`, `web/pwa/dom/transfer/`                                                                                    |
|                  | 4     | `web/ui/dom/dialogs/`, `web/pwa/dom/routing/`                                                                                                            |
|                  | 5     | `web/crash/dom/`, `web/progress/dom/`                                                                                                                    |
|                  | 6     | `web/pwa/dom/launch/`                                                                                                                                    |
| Support          | 1     | `build/` (build-time code: pure at its top, Node and Vite in `build/vite/`), `testing/`                                                                  |

Every `dom/` and `phaser/` directory is in Engine and views or Support, so only those bands
import Phaser or the DOM. Nothing in `src/` imports `scripts/` or `tests/`.

ESLint uses `SOURCE_BANDS` and `DIRECT_MODULES` in `eslint.config.mjs` to reject imports into
later layers, into private modules of another area, or into `scripts/` or `tests/`. This
includes type-only imports and re-exports. The config requires one area per shipped module.

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
| gk-0079 | Audit GameKit documentation against current source                           | [gk-0079.md](../work/gk-0079.md) |
| gk-0080 | Add Dependabot coverage for GameKit                                          | [gk-0080.md](../work/gk-0080.md) |
| gk-0083 | Publish GameKit 0.92.0 with updater recovery                                 | [gk-0083.md](../work/gk-0083.md) |
| gk-0085 | Organize shared modules by responsibility                                    | [gk-0085.md](../work/gk-0085.md) |
| gk-0091 | Organize GameKit documentation around topic guides                           | [gk-0091.md](../work/gk-0091.md) |
