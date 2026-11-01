# @andornaut/game-kit

Game-independent TypeScript mechanisms and adapters for Phaser games, browser pages and build tools. Games supply their content, strings, palettes, dimensions, schemas and tuning.

## Importing

Import a module by its path under `src/`, without the extension:

```ts
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/random";
```

This is one source package at the repository root, not a compiled distribution. Explicit package exports expose the supported modules and stylesheets; tests are internal. Import individual modules so pure clients do not load an engine adapter. Declare `"@andornaut/game-kit": "file:vendor/game-kit"` in the client's dependencies and install it with the client lockfile. TypeScript, tsx, Vite and Vitest resolve the same explicit package exports. Do not add source aliases: they bypass package encapsulation. Clients retain `noEmit: true` and set `allowImportingTsExtensions: true`; internal source imports include their `.ts` extension for native Node 24 resolution. Internal imports are relative. `KIT_COMMIT`, beside this file in a game's copy, records the exact source commit. Update the canonical game-kit repository, then copy it with `scripts/sync-into.sh`; never edit the vendor copy by hand.

## Version and interface policy

The source package is version `0.2.3`. `KIT_COMMIT` remains the exact source identity; a version never substitutes for the recorded revision. The explicit `exports` map and exported TypeScript declarations define the public interface. Deep `src/` paths, tests and standalone scripts are private. `build/buildInfo` exposes declarations only through the TypeScript `types` condition; it has no runtime entry.

Use patch versions for compatible fixes, minor versions for additive public facilities, and a major version for incompatible changes after 1.0. Before 1.0, incompatible changes require a minor version bump and an explicit migration. Preserve existing subpaths with compatibility exports when practical. Update the manifest and root lockfile together; prove both clients against exact revisions before canonical integration. Documentation-only changes do not require a version bump.

## Package structure

```text
package.json          Public exports, optional peers and development commands
package-lock.json     One dependency lockfile
README.md             Package and client integration reference
LICENSE               MIT licence
src/                  Source modules and colocated tests
  art/                Pixel/animation mechanisms and Node codecs
  build/              Build metadata, Phaser analysis and Vite adapters
  clock/              Pure clocks and Phaser frame adapter
  crash/              Pure crash model and DOM presentation
  headers/            Header generation and Vite adapter
  input/              Pure input policies, DOM and Phaser adapters
  progress/           DOM and Phaser bar adapters
  pwa/                Browser lifecycle, service worker and Vite adapters
  save/               Save interfaces and storage implementations
  text/               Pure font metrics and Phaser font adapter
  view/               Pure geometry, DOM layout and Phaser presentation
scripts/              Isolated verification and exact-commit consumer sync
```

Every module belongs to this package. `phaser/`, `dom/` and `vite/` subdirectories identify adapters where present; the module table identifies the remaining browser and Node facilities. Internal imports are relative and acyclic. There is no root barrel that combines Node tooling, browser APIs and Phaser.

## Standalone verification

```bash
bash scripts/check.sh
```

The gate uses Node 24.21.0, at most four CPUs and four Vitest workers. It installs into container tmpfs from the repository-local npm cache, then checks types, formatting, lint and tests without network access. The checkout is read-only and source fingerprints must remain stable. CI invokes the same script. Start below one-minute load 24. Both verification jobs use the same fail-closed load check and derive their container image from the root `.nvmrc`, accepting its optional `v` prefix. `GAME_KIT_NPM_CACHE` selects an existing cache for either job.

| Command                      | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `npm run check`              | Type-check the source and configuration          |
| `npm run lint`               | Check formatting, ESLint boundaries and Markdown |
| `npm test -- --maxWorkers=4` | Run unit and package contract tests              |
| `npm run format`             | Format a writable checkout                       |

These npm commands run inside the isolated verification container. The package ships TypeScript source; it has no separate compilation or release-build step.

The gate checks pure ECMAScript, browser, service-worker, Phaser and Node environments separately, then the combined source/test project. Negative compilation fixtures reject foreign ambient globals; isolated package fixtures load a pure module without peers and the PNG adapter with only its PNG peer. Renderer adapters require their declared engine peer.

## Two-consumer compatibility job

```bash
GAME_KIT_NPM_CACHE=/path/to/populated/npm-cache \
  npm run check:consumers -- /path/to/dog <Dog commit> /path/to/duck <Duck commit>
```

The job pins the current kit HEAD and both supplied Git revisions, exports clean snapshots into retained scratch space, installs the exact kit payload, updates only snapshot lock metadata offline, and runs real client type checks, shared Vite bootstrap tests, native tsx imports, CSS resolution and private-path rejection. It never builds or deploys a game and never edits either checkout. Input consumer revisions must already declare the local file dependency. Populate the cache through the projects' existing install process; a missing offline dependency fails the job. Results and exact revision identifiers are retained in the printed `.claude/consumer-check.*` directory. This local Docker job also works in CI when its runner has both repository object stores and the populated cache; it requires no new credentials or remote service.

## Consumer sync

```bash
scripts/sync-into.sh <game repository or worktree>
scripts/sync-into.sh --check <game repository or worktree>
```

Sync exports the committed `src/`, root package metadata, README and licence into `vendor/game-kit/` and writes the exact source revision to `KIT_COMMIT`. It removes obsolete files only within that vendor directory. The vendor payload excludes standalone gate configuration and development tooling. Its generated manifest preserves the root package name, version, exports and peers, but omits development dependencies and scripts, so a local file dependency does not install the kit’s lint tools into a game. The transform is taken from the same recorded revision; there is no second authored manifest. Sync requires Node 24.21.0, Bash, Git, tar and coreutils. `--check` reads the recorded commit and compares the entire payload, including copies made from the nested layout at older revisions. A dirty checkout is not exported.

No registry, account or installation is required for source vendoring. Games retain their `@andornaut/game-kit/*` imports and `vendor/game-kit/src/*` payload layout. Import `gameViteConfig` from `@andornaut/game-kit/build/vite/gameConfig` in `vite.config.ts`; native file-package resolution is available before the configuration loads. Consumers include vendor source/tests in their type/test checks and exclude it from their own formatting/lint gates. Land a canonical commit, then sync that exact revision into each consumer in a separate commit.

## Modules and environments

Paths below are relative to `src/`. Pure modules use no browser, renderer or Node APIs; browser and tooling modules are named separately even when they share a directory.

| Modules                                                                                                           | Environment                                   | Responsibility                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrays`, `assertNever`, `lines`, `maps`, `numbers`, `opaqueBounds`, `random`, `records`, `rect`, `rgba`, `units` | Pure                                          | Collections, seeded randomness, geometry, pixel bounds, colour remapping and branded units                                                                                         |
| `art/aseprite`, `art/rgbaImage`                                                                                   | Pure                                          | Aseprite animation specifications and RGBA atlas primitives; games validate asset JSON                                                                                             |
| `art/png`, `art/webp`                                                                                             | Node                                          | PNG decoding and deterministic lossless WebP encoding/decoding                                                                                                                     |
| `build/buildLabel`, `build/buildInfo.d.ts`                                                                        | Bundled runtime                               | Build label and declarations for `__APP_VERSION__` and `__COMMIT__`, supplied by the bundler                                                                                       |
| `build/buildVersion`, `build/contentHash`, `build/phaserBuild`, `build/phaserUses`                                | Node                                          | Commit labels, content hashes, reduced Phaser builds and static checks of Phaser usage                                                                                             |
| `build/vite/`, `headers/vite/`, `pwa/vite/`                                                                       | Node, Vite                                    | Shared game configuration, Phaser bundling, security headers, hashed icons and service-worker generation                                                                           |
| `clock/fixedStep`, `clock/frameCap`                                                                               | Pure                                          | Fixed-step timing and frame-cap decisions                                                                                                                                          |
| `crash/crashModel`                                                                                                | Pure                                          | Crash classification and presentation data                                                                                                                                         |
| `headers/securityHeaders`                                                                                         | Browser or Node, Web Crypto                   | CSP block extraction, SHA-256 hashing and header rendering                                                                                                                         |
| `crash/crashScreen`, `crash/crash.css`                                                                            | Browser DOM                                   | Crash screen in the game's words and colours; import the stylesheet separately for CSP compatibility                                                                               |
| `input/modalInput`, `input/outsideTap`, `input/tapGuard`, `modalLayout`                                           | Pure                                          | Top-modal input ownership, gesture invalidation, outside-tap decisions, first-frame input guards and modal face constraints                                                        |
| `input/pagePresses`, `sessionStore`, `view/frameTurn`, `view/frameTurn*.css`                                      | Browser DOM                                   | Page pointer tracking, session storage, orientation changes and safe-area mapping                                                                                                  |
| `motion`                                                                                                          | Pure                                          | Immutable two-dimensional segments and linear or sine-in-out easing                                                                                                                |
| `progress`, `progressState`                                                                                       | Pure                                          | Shared bar geometry and operation state with stale-callback isolation                                                                                                              |
| `progress/dom/progressBar`                                                                                        | Browser DOM                                   | Progress bar using the shared geometry, before Phaser loads                                                                                                                        |
| `pwa/` except the pure modules, worker and `vite/` modules below                                                  | Browser                                       | Installation, app exit/back handling, offline/update flow, persistence and wake lock; host interfaces also permit unit tests                                                       |
| `pwa/cachePolicy`, `pwa/hashedIcons`, `pwa/precacheList`, `pwa/serviceWorkerUrl`                                  | Pure                                          | Cache policy, icon naming, precache selection and sound-format URL parameters                                                                                                      |
| `pwa/serviceWorker`                                                                                               | Service worker                                | Offline caching and update activation for the game's policy and precache manifest                                                                                                  |
| `save/`                                                                                                           | Pure contracts/store, browser storage adapter | Versioned JSON saves, corrupt-save backup and write protection after unavailable storage or a newer save; `localSaveStorage` wraps localStorage and `memoryStorage` supports tests |
| `text/` except `text/phaser/`                                                                                     | Pure                                          | BMFont parsing, measurement, fixed-size wrapping and overflow reports                                                                                                              |
| `view/fitCheck`, `view/pagePoint`, `view/settleFit`                                                               | Pure                                          | Canvas-fit decisions, rotated pointer mapping and bounded layout settling                                                                                                          |
| `clock/phaser/`, `input/phaser/`, `progress/phaser/`, `text/phaser/`, `view/phaser/`                              | Phaser, browser                               | Frame-cap application, input guards, progress drawing, font-cache access, viewport fitting, palette-remapped snapshots and modal backdrop ownership                                |

## Dependencies

The optional peers in [package.json](package.json) declare supported versions. Install the peers used by the modules you import in the consuming game's own package; the vendor copy has no `node_modules`, and copying it does not install dependencies. Pure helpers require none of these runtime packages. Optional means unused module families do not require installation, not that an imported adapter can run without its dependency.

| Dependency      | Required by                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `@jsquash/webp` | `art/webp`, including its packaged WebAssembly codecs; retain the exact pin for reproducible output |
| `@types/node`   | Type checking Node tooling and tests                                                                |
| `@types/pngjs`  | Type checking `art/png`                                                                             |
| `phaser`        | `phaser/` adapters and the Phaser build/usage tools                                                 |
| `pngjs`         | `art/png`; retain the exact pin for asset decoding                                                  |
| `typescript`    | Compiling the source and the runtime AST scan in `build/phaserUses`                                 |
| `vite`          | `vite/` modules, including `runnerImport` in `build/vite/gameConfig`                                |
| `vitest`        | Copied `*.test.ts` files and configuration types imported by `build/vite/gameConfig`                |

Node tooling and the standalone gate target Node 24.21.0. Browser modules need DOM types; Node modules need Node types. Consumers that type-check all copied source or run all copied tests need every applicable peer and type package, even when the shipped browser entry imports only a subset. The root package and lockfile supply the standalone development dependencies.

## Integration contracts

- **Build:** `gameViteConfig` expects `pages/`, `public/`, `src/`, `vendor/game-kit/src/` and `package.json`, and writes `dist/`. Import it through the package exports from `vite.config.ts`. It loads the game's configuration module through native package resolution, defines the build globals, and includes both game and kit tests. Games supply pages, plugins, preview host, chunk warning limit and test timeout.
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks, randomness, movement profiles, physics and collisions. `motion/Point` is a compatibility type export of the same immutable point contract as `rect/Point`.
- **Progress:** `undefined` means an unknown total, drawn as a static centred segment; finite values are clamped from zero to one. `createProgressState` replaces the previous operation on each `begin`; stale handles cannot update or finish its replacement. DOM and Phaser adapters share geometry. Games own visibility, timing and accessible labels; the caller clears Phaser graphics.
- **Saves:** games own keys, schemas, validation and migration policy. A newer stored version is preserved; a corrupt save is backed up before replacement. Failed storage access disables writes for the session.

## Engine and client contract

The kit provides mechanisms, not game policy. Clients own scene creation, clocks, content, strings, palettes, dimensions, schemas, tuning, randomness, physics, collisions and persistence keys. Pure modules accept explicit data and return values; browser and renderer adapters own only the resources specified by their interfaces. Clients mount and dispose adapters at their lifecycle boundaries. `followFrameTurn` returns an idempotent disposer and also disposes on game destruction: it stops fitting, removes its listeners and observer, and restores only method wrappers it still owns. The page retains ownership of its frame-turn watch and CSS properties.

For example, `createProgressState()` returns operation handles that reject stale callbacks; clients decide when to begin, update, finish and display progress. `mountModalBackdrop(context, area)` receives a scene, depth, fallback colour, colour mapper and dimensions, and returns a `ready` promise and `destroy()` handle. The client chooses modal layout, input ownership and gameplay pausing. `saveStore(storage, keys, format)` receives the client's save schema and storage port; the kit does not choose a migration or reset policy.

```ts
import { createProgressState } from "@andornaut/game-kit/progressState";
import { modalDimmer } from "@andornaut/game-kit/view/modalDim";

const progress = createProgressState();
const operation = progress.begin();
operation.progress(0.5);
operation.finish();
// The client supplies its one-step palette map.
declare const clientPaletteStep: ReadonlyMap<number, number>;
const remap = modalDimmer(clientPaletteStep);
```

## Boundary

The kit imports no game code and holds no player text. Only `phaser/` folders import Phaser, and only `vite/` folders import Vite; the canonical repository's ESLint configuration enforces these boundaries and relative internal imports. DOM and Node modules remain separate from pure mechanisms without requiring separate packages.

## Licence

[MIT](LICENSE). The consuming game keeps its own licence.
