# game-kit

Game-independent TypeScript mechanisms and adapters for Phaser games, browser pages and build tools. Games supply their content, strings, palettes, dimensions, schemas and tuning.

## Importing

Import a module by its path under `src/`, without the extension:

```ts
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/random";
```

The final consumer distribution is the compiled GitHub release artifact described below. The repository also supports source-based development snapshots. Explicit package exports expose the supported modules and stylesheets; tests are internal. Import individual modules so pure clients do not load an engine adapter. Install the versioned GitHub tarball URL with the client lockfile. Use `file:vendor/game-kit` only for source-based development snapshots. TypeScript, tsx, Vite and Vitest resolve the same explicit package exports. Do not add source aliases: they bypass package encapsulation. Release exports resolve to JavaScript and declarations. Development source imports use `.ts` extensions and require `allowImportingTsExtensions: true` when type checking. Internal imports are relative. `KIT_COMMIT`, beside this file in a game's copy, records the exact source commit. Update the canonical game-kit repository, then copy it with `scripts/sync-into.sh`; never edit the vendor copy by hand.

## Version and interface policy

The source package is version `0.3.1`. `KIT_COMMIT` remains the exact source identity; a version never substitutes for the recorded revision. The explicit `exports` map and exported TypeScript declarations define the public interface. Deep `src/` paths, tests and standalone scripts are private. `build/buildInfo` exposes declarations only through the TypeScript `types` condition; it has no runtime entry.

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
  terrain/            Pure bounded traversal and collision stepping
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

These npm commands run inside the isolated verification container. Development snapshots ship TypeScript source. Release packaging emits JavaScript and declarations with `tsconfig.release.json`.

The gate checks pure ECMAScript, browser, service-worker, Phaser and Node environments separately, then the combined source/test project. Negative compilation fixtures reject foreign ambient globals; isolated package fixtures load a pure module without peers and the PNG adapter with only its PNG peer. Renderer adapters require their declared engine peer.

## Two-consumer compatibility job

```bash
GAME_KIT_NPM_CACHE=/path/to/populated/npm-cache \
  npm run check:consumers -- /path/to/dog <Dog commit> /path/to/duck <Duck commit>
```

The job pins the current kit HEAD and both supplied Git revisions, exports clean snapshots into retained scratch space, installs the exact kit payload, updates only snapshot lock metadata offline, and runs real client type checks, native bootstrap of each client’s actual Vite configuration, native tsx imports, CSS resolution and private-path rejection. It never builds or deploys a game and never edits either checkout. Input consumer revisions must already declare the local file dependency. Populate the cache through the projects' existing install process; a missing offline dependency fails the job. Results and exact revision identifiers are retained in the printed `.claude/consumer-check.*` directory. This local Docker job also works in CI when its runner has both repository object stores and the populated cache; it requires no new credentials or remote service.

## Development snapshot sync

```bash
scripts/sync-into.sh <game repository or worktree>
scripts/sync-into.sh --check <game repository or worktree>
```

Sync exports the committed `src/`, root package metadata, README and licence into `vendor/game-kit/` and writes the exact source revision to `KIT_COMMIT`. It removes obsolete files only within that vendor directory. The vendor payload excludes standalone gate configuration and development tooling. Its generated manifest preserves the root package name, version, exports and peers, but omits development dependencies and scripts, so a local file dependency does not install the kit’s lint tools into a game. The transform is taken from the same recorded revision; there is no second authored manifest. Sync requires Node 24.21.0, Bash, Git, tar and coreutils. `--check` reads the recorded commit and compares the entire payload, including copies made from the nested layout at older revisions. A dirty checkout is not exported.

No registry, account or installation is required for source vendoring. Games retain their `@andornaut/game-kit/*` imports and `vendor/game-kit/src/*` payload layout. Import `gameViteConfig` from `@andornaut/game-kit/build/vite/gameConfig` in `vite.config.ts`; compiled package resolution is available before the configuration loads; source snapshots are development-only. Consumers test only their own application wiring and adapters under `src/**/*.test.ts`, treating the library as a working dependency. Library implementation and contract tests belong to the canonical library suite, including for source snapshots; vendor source is excluded from consumer formatting/lint gates. Land a canonical commit, then sync that exact revision into each consumer in a separate commit.

## Modules and environments

Paths below are relative to `src/`. Pure modules use no browser, renderer or Node APIs; browser and tooling modules are named separately even when they share a directory.

| Modules                                                                                                                                          | Environment                                   | Responsibility                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrays`, `assertNever`, `lines`, `maps`, `numbers`, `opaqueBounds`, `random`, `records`, `rect`, `rgba`, `units`                                | Pure                                          | Collections, seeded randomness, geometry, pixel bounds, colour remapping and branded units                                                                                         |
| `art/aseprite`, `art/atlasBuild`, `art/atlasLayout`, `art/rgbaImage`                                                                             | Pure                                          | Aseprite animation specifications, atomic shelf packing, injected atlas page orchestration and RGBA primitives; games validate asset JSON                                          |
| `art/png`, `art/webp`                                                                                                                            | Node                                          | PNG decoding and deterministic lossless WebP encoding/decoding                                                                                                                     |
| `build/buildLabel`, `build/buildInfo.d.ts`                                                                                                       | Bundled runtime                               | Build label and declarations for `__APP_VERSION__` and `__COMMIT__`, supplied by the bundler                                                                                       |
| `build/buildVersion`, `build/contentHash`, `build/phaserBuild`, `build/phaserUses`                                                               | Node                                          | Commit labels, content hashes, reduced Phaser builds and static checks of Phaser usage                                                                                             |
| `build/vite/`, `headers/vite/`, `pwa/vite/`                                                                                                      | Node, Vite                                    | Shared game configuration, Phaser bundling, security headers, hashed icons and service-worker generation                                                                           |
| `clock/fixedStep`, `clock/frameCap`                                                                                                              | Pure                                          | Fixed-step timing and frame-cap decisions                                                                                                                                          |
| `crash/crashModel`                                                                                                                               | Pure                                          | Crash classification and presentation data                                                                                                                                         |
| `headers/securityHeaders`                                                                                                                        | Browser or Node, Web Crypto                   | CSP block extraction, SHA-256 hashing and header rendering                                                                                                                         |
| `crash/crashScreen`, `crash/crash.css`                                                                                                           | Browser DOM                                   | Crash screen in the game's words and colours; import the stylesheet separately for CSP compatibility                                                                               |
| `input/hold`, `input/listScroll`, `input/onePress`, `input/targetPress`, `input/modalInput`, `input/outsideTap`, `input/tapGuard`, `modalLayout` | Pure                                          | Press ownership, target release, hold and scroll state with supplied tuning, modal ownership, gesture guards and modal face constraints                                            |
| `input/pagePresses`, `sessionStore`, `view/frameTurn`, `view/frameTurn*.css`                                                                     | Browser DOM                                   | Page pointer tracking, session storage, orientation changes and safe-area mapping                                                                                                  |
| `motion`                                                                                                                                         | Pure                                          | Immutable two-dimensional segments and linear or sine-in-out easing                                                                                                                |
| `progress`, `progressState`                                                                                                                      | Pure                                          | Shared bar geometry and operation state with stale-callback isolation                                                                                                              |
| `progress/dom/progressBar`                                                                                                                       | Browser DOM                                   | Progress bar using the shared geometry, before Phaser loads                                                                                                                        |
| `pwa/` except the pure modules, worker and `vite/` modules below                                                                                 | Browser                                       | Installation, app exit/back handling, offline/update flow, persistence and wake lock; host interfaces also permit unit tests                                                       |
| `pwa/cachePolicy`, `pwa/hashedIcons`, `pwa/precacheList`, `pwa/serviceWorkerUrl`                                                                 | Pure                                          | Cache policy, icon naming, precache selection and sound-format URL parameters                                                                                                      |
| `pwa/serviceWorker`                                                                                                                              | Service worker                                | Offline caching and update activation for the game's policy and precache manifest                                                                                                  |
| `save/`                                                                                                                                          | Pure contracts/store, browser storage adapter | Versioned JSON saves, corrupt-save backup and write protection after unavailable storage or a newer save; `localSaveStorage` wraps localStorage and `memoryStorage` supports tests |
| `terrain/traversal`                                                                                                                              | Pure                                          | Shared runtime/search terrain stepping, bounded reachability and explicit geometry/budget results                                                                                  |
| `text/` except `text/phaser/`                                                                                                                    | Pure                                          | BMFont parsing, measurement, fixed-size wrapping, overflow reports and pixel atlas geometry from supplied glyphs                                                                   |
| `view/fitCheck`, `view/pagePoint`, `view/settleFit`                                                                                              | Pure                                          | Canvas-fit decisions, rotated pointer mapping and bounded layout settling                                                                                                          |
| `clock/phaser/`, `input/phaser/`, `progress/phaser/`, `text/phaser/`, `view/phaser/`                                                             | Phaser, browser                               | Frame-cap application, input guards, progress drawing, font-cache access and pixel atlas registration, viewport fitting, palette-remapped snapshots and modal backdrop ownership   |

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

Node tooling and the standalone gate target Node 24.21.0. Browser modules need DOM types; Node modules need Node types. Consumers that type-check copied source need its applicable peers and types; they do not run copied library tests. The root package and lockfile supply the standalone development dependencies.

WORKAROUND: Parent-scoped development overrides pin [KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) `0.18.2`, [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) `11.0.3` and [re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) `2.8.7`. ESLint loads the cycle rule and resolver through exported plugin subpaths because the full plugin imports an unused rule requiring the removed minimatch `makeRe` API. Keep cycle detection enabled. Remove each override when its parent range supports the patched version; restore the full plugin import when it supports minimatch 11.

## Integration contracts

- **Audio:** `pwa/audioUnlock` receives an explicit gesture target and resumable audio context. It retries on supported gestures until running; the returned disposer removes its listeners. Clients own audio creation, playback and teardown.
- **Build:** `gameViteConfig` expects `pages/`, `public/`, `src/` and `package.json`, and writes `dist/`. Its test include list is `src/**/*.test.ts` for application-owned tests only; installed release tests are not shipped. Import it through the package exports from `vite.config.ts`. It loads the game's configuration module through native package resolution, defines the build globals, and includes only game-owned tests. Games supply pages, plugins, preview host, chunk warning limit and test timeout.
- **Input:** `input/hold`, `input/listScroll`, `input/onePress` and `input/targetPress` return press and scroll state from explicit events, coordinates and times. Clients supply hold thresholds, drag and fling tuning, target equality, release timing and reduced-motion choices, and perform the resulting actions.
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks, randomness, movement profiles, physics and collisions. `motion/Point` is a compatibility type export of the same immutable point contract as `rect/Point`.
- **Pixel fonts:** `text/pixelFont` accepts glyph bits, widths, height, spacing and space width through `PixelFontContext`; it returns atlas geometry and advances. Clients own glyph definitions and text normalization. `text/phaser/registerPixelFont` registers a supplied atlas with the scene using explicit key, colour, size, line height and space advance.
- **Progress:** `undefined` means an unknown total, drawn as a static centred segment; finite values are clamped from zero to one. `createProgressState` replaces the previous operation on each `begin`; stale handles cannot update or finish its replacement. DOM and Phaser adapters share geometry. Games own visibility, timing and accessible labels; the caller clears Phaser graphics.
- **Saves:** games own keys, schemas, validation and migration policy. A newer stored version is preserved; a corrupt save is backed up before replacement. Failed storage access disables writes for the session.

## Atlas packing

`art/atlasLayout` exports `packAtlas(policy, items)`. Callers supply rectangle groups that stay on one page, their sort comparator, extrusion, maximum size and candidate widths. The shared shelf solver prefers fewer pages, then less area, retaining the first supplied width on ties. Clients own normalization, grouping, source-rectangle deduplication, manifests, frame metadata, trimming, recolouring and output names.

`art/atlasBuild` exports `drawAtlasPage(extrude, images, page)` and `buildAtlasPages(dependencies, pages)`. Both modules are pure and browser-safe. The latter accepts injected read/decode/encode functions and optional decoded images, reads and decodes each uncached source once across all pages, and encodes exactly once per page. It preserves page/blit order, bounds and caller metadata; missing draw sources and dependency failures propagate to the client.

## Terrain traversal

`terrain/traversal` exports `stepTraversal(context, input, state)` and `findTraversal(context, request)`. Runtime and search execute the same finite-AABB kernel: immediate horizontal intent, fixed-step gravity/jump/fall, swept solid side/ceiling clipping and moving-solid push/carry. Ledges block only downward relative crossings, without snapping from below. Safe grounding requires full-foot support and body clearance. The goal is a landing envelope or corridor containing the complete body, not a smaller target actor rectangle.

Callers supply resolved pixels/second, absolute seconds, body dimensions/offset, profile, timestep, bounds, drop limit, collision iteration limit and swept-body hazard predicates. `sampleColliders(timeSeconds, dtSeconds, queryBounds)` returns complete swept-entrant coverage with opaque stable owner identities, solid/ledge kinds and before/after rectangles. Ordinary mover endpoints describe the exact discrete tick path even when authored easing is nonlinear; graph movers supply contiguous absolute-time segments. Supply deterministic future samples only when known. Unknown reactive futures return `complete: false`; the kit never projects the whole world. Callers retain self-exclusion, snapshot ordering, cache lifecycle and pursuit policies.

`TraversalBudget` supplies explicit finite `horizonSteps`, `maxStates` and `maxSteps`; `maxCollisionSteps` is explicit in the context. Search returns a replayable `found` witness, `unreachable` only within the exhaustively searched finite domain, `budget-exhausted` when work limits prevent completion, or distinct `geometry-unavailable` for incomplete geometry. Step failures return the original state and no committed segments. Mixed-motion support unions do not establish safe grounding; pushes beyond the sampled domain return `geometry-unavailable`. Revalidate every executed step against current geometry.

## Manual PWA updates

`startOfflinePlay(options, page)` accepts `activationPolicy: "manual"`; `createUpdateFlow(container, now, online, reload, show, options?)` accepts the same optional policy. The default remains `"automatic"`. Manual mode never activates a waiting worker or reloads on controller changes before explicit `flow.accept()`. Boot checks and installation still wait up to `bootWaitMs`; activity reporting and arrival/resume check cadence are unchanged.

Keep registration readiness separate from offer eligibility:

- Call `play.setRegistrationReady(true)` at the client's first safe install point: Dog's first Start arrival or Chibi's first prepared zone frame. Controlled pages register immediately; first installs register once readiness is true.
- Call `play.setOfferVisible(visible)` for offer eligibility. It never registers a worker or clears dismissal.
- Call `play.flow.beginOfferVisit()` when creating a new offer visit, such as Dog's Start scene creation. Pause/resume and temporary visibility changes do not begin a visit.
- Call `play.flow.dismissOffer()` for Cancel. It suppresses offers until the next `beginOfferVisit()`, retaining the waiting worker across visibility changes and update checks.

The explicit Update now action calls `flow.accept()`: activate the waiting worker and reload once it takes control, or reload immediately when none is waiting (including a newer-save fallback offer). Repeated acceptance while reloading does nothing. Legacy `setOnHome()` combines registration readiness and eligibility, resetting dismissal on a false-to-true arrival. Do not use it for clients with independent visit lifecycles.

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

## Numeric and text measurement contracts

`numbers.clamp(minimum, maximum, value)` evaluates `Math.min(maximum, Math.max(minimum, value))`. It does not reorder bounds or throw: NaN propagates and reversed bounds return the maximum for a non-NaN input. Preserve a caller's opposite nesting unless its ordered bounds are established. `lerp(from, to, fraction)` evaluates `from + (to - from) * fraction` without clamping, sanitizing non-finite values or short-circuiting endpoints.

`text/bitmapFont.advanceWidth(font, scale, line)` measures pen advance, including trailing whitespace and kerning. Missing glyphs are skipped without replacing the previous known glyph. `inkWidth` measures visible columns and remains a distinct operation.

## Release artifacts

The public source repository is [andornaut/game-kit](https://github.com/andornaut/game-kit). Version 0.3.1 uses the GitHub release asset `game-kit-0.3.1.tgz`, without npm registry publication. After publication, install the versioned artifact:

```json
{
  "dependencies": {
    "@andornaut/game-kit": "https://github.com/andornaut/game-kit/releases/download/v0.3.1/game-kit-0.3.1.tgz"
  }
}
```

Commit the consumer lockfile so the exact URL and integrity are recorded. Public imports remain `@andornaut/game-kit/<path>`; Node 24.21.0, TypeScript, Vite and test runners resolve the installed package through its explicit exports. No client source alias is required. Existing source-sync scripts remain available for isolated development snapshots.

`bash scripts/pack.sh <output-directory>` builds the committed revision in an isolated offline container. It writes the npm-compatible archive, `SHA256SUMS` and `SOURCE_COMMIT`; the archive carries the same provenance file. It includes emitted JavaScript, declarations, CSS, public metadata, README and licence, without TypeScript runtime source, tests, standalone development dependencies or scripts. Release exports preserve every explicit subpath; `build/buildInfo` remains type-only. Node cannot strip TypeScript inside `node_modules`. The gate tests the actual packed artifact there, including native Vite configuration bootstrap. The source CI checks the library and uploads these reviewable artifacts without publishing a release. Publish an immutable version tag only after CI is green for that exact main commit.
