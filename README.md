# game-kit

Game-independent TypeScript mechanisms, Phaser adapters and website infrastructure. Games supply content, strings, palettes, dimensions, schemas, tuning, policies and lifecycle. Parent projects own their asset tooling and wire `web/*` modules into their own pages and Vite configuration.

## Importing

Import individual public modules without an extension:

```ts
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/random";
import { memoryStorage, type SaveStorage } from "@andornaut/game-kit/save/storage";
```

Install the compiled release archive by its versioned URL, `https://github.com/andornaut/game-kit/releases/download/v<version>/game-kit-<version>.tgz`, and commit the lockfile with its URL and integrity. The archive holds JavaScript and declarations; `SOURCE_COMMIT`, inside it and alongside it, records the source revision. Tests and scripts are private.

Pure imports need no runtime peers. Phaser, TypeScript, Vite and Vitest are optional peers: `phaser/` adapters need the game's `phaser`, `vite/` modules its `vite`, `web/build/vite/phaserUses` its `typescript` and `web/build/vite/gameConfig` its `vitest`. Every `phaser/` adapter may import Phaser at runtime, so a game test that mocks it with `vi.mock("phaser")` must inline the kit with `test.server.deps.inline: ["@andornaut/game-kit"]`.

## Version and interface policy

The `exports` map and the exported declarations define the public interface. Internal imports are relative and acyclic, and there is no root barrel, so a pure import loads no engine.

Compatible fixes are patch versions and additions are minor versions. Incompatible changes are major versions after 1.0, and minor versions with a migration section below before 1.0. Update the manifest and lockfile together. Documentation-only changes need no version bump.

## Modules and environments

Paths are relative to `src/`, and tests sit beside their modules. Every module is a public path except `input/tapGuard`, `terrain/fnv1a64`, `text/phaser/uiGlyphPen` and `web/build/mapLimit`, which are internal.

| Modules                                                                                                           | Environment              | Responsibility                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `achievements`, `achievements/preview`                                                                            | Pure                     | Badge judging, tier order, awarding, the earned record and unlock notices        |
| `ai/utility`                                                                                                      | Pure                     | Scored action choice with hysteresis and a seeded tie-break                      |
| `arrays`, `assertNever`, `lines`, `maps`, `numbers`, `opaqueBounds`, `random`, `records`, `rect`, `rgba`, `units` | Pure                     | Collections, text fields, geometry, randomness, pixels and units                 |
| `art/aseprite`, `art/rgbaImage`                                                                                   | Pure                     | Animation specifications and RGBA primitives                                     |
| `clock/fixedStep`, `clock/frameCap`                                                                               | Pure                     | Fixed-step timing and frame-cap decisions                                        |
| `input/*` except `input/phaser/*`, `modalLayout`                                                                  | Pure                     | Press, hold, scroll, gesture and modal state                                     |
| `motion`                                                                                                          | Pure                     | Immutable motion segments and easing                                             |
| `progress`, `progressState`                                                                                       | Pure                     | Bar geometry and operation state                                                 |
| `save/*`                                                                                                          | Pure                     | Storage contract, memory implementation, versioning and save coordination        |
| `terrain/crumbling`, `terrain/traversal`                                                                          | Pure                     | Fixed-tick support lifecycle, bounded search and shared collision stepping       |
| `terrain/airMap`                                                                                                  | Pure                     | Flyer clear-cell graph, perch links and axis-change-penalty search               |
| `terrain/movementMap`                                                                                             | Pure                     | Baked ground spans, kernel-witnessed edges and masked shortest-time queries      |
| `text/*` except `text/phaser/*`                                                                                   | Pure                     | Bitmap font metrics, fixed-size wrapping, overflow and pixel atlas geometry      |
| `view/fitCheck`, `view/modalDim`, `view/pagePoint`, `view/settleFit`                                              | Pure                     | Fit decisions, palette dimming, coordinate mapping and bounded settling          |
| `web/build/buildLabel`, `web/build/buildVersion`, `web/build/phaserBuild`                                         | Pure                     | Build labels, commit selection, reduced Phaser entries and feature flags         |
| `web/crash/crashModel`                                                                                            | Pure                     | Crash classification and presentation data                                       |
| `web/headers/securityHeaders`                                                                                     | Pure                     | Content-Security-Policy rules and Cloudflare `_headers` rendering                |
| `web/pwa/*` except `web/pwa/dom/*` and `web/pwa/vite/*`                                                           | Pure                     | App window, install, back, fetch strategy, precache, icons, storage and updates  |
| `web/save/sessionStore`, `web/save/storage`                                                                       | Pure                     | Never-throwing session store and Web Storage save adapters                       |
| `web/view/frameTurn` and its `frameTurn*Game.css` stylesheets                                                     | Pure, CSS                | Page frame turn policy and the turned-frame stylesheets                          |
| `clock/phaser/*`, `input/phaser/*`, `progress/phaser/*`, `text/phaser/*`, `view/phaser/*`                         | Phaser, browser renderer | Frame caps, input guards, progress drawing, fonts, snapshots and modal backdrops |
| `web/view/phaser/followFrameTurn`                                                                                 | Phaser, browser renderer | Phaser fitting and pointer mapping through the page frame turn                   |
| `web/crash/dom/crashScreen`, `web/crash/dom/crash.css`                                                            | Browser DOM              | Crash screen in the game's words and colours; Reload applies a waiting update    |
| `web/input/dom/pagePresses`                                                                                       | Browser DOM              | Page pointer presses followed from pointerdown until they lift or cancel         |
| `web/progress/dom/progressBar`                                                                                    | Browser DOM              | Progress bar using the shared geometry, before Phaser loads                      |
| `web/pwa/dom/*`                                                                                                   | Browser DOM              | Visibility, wake lock, audio, back, exit, install, offline play, service worker  |
| `web/save/dom/localSaveStorage`, `web/save/dom/pageSessionStore`                                                  | Browser DOM              | The page's `localStorage` and `sessionStorage`                                   |
| `web/view/dom/watchFrameTurn`                                                                                     | Browser DOM              | Marks the frame turn on `<html>` and requests the orientation lock               |
| `web/headers/vite/securityHeadersPlugin`                                                                          | Vite, Node build time    | Writes `_headers` with per-page inline hashes                                    |
| `web/build/vite/buildInfo`, `web/build/vite/gameConfig`                                                           | Vite, Node build time    | Build constant declarations and a game's whole Vite and Vitest config            |
| `web/build/vite/contentHash`, `web/build/vite/gitHead`                                                            | Vite, Node build time    | Vite-compatible content hashes and the repository HEAD                           |
| `web/build/vite/phaserBuildPlugin`, `web/build/vite/phaserSource`, `web/build/vite/phaserUses`                    | Vite, Node build time    | Reduced Phaser bundles from source, and a static check of a game's Phaser use    |
| `web/pwa/vite/hashedIconsPlugin`, `web/pwa/vite/precachePlugin`                                                   | Vite, Node build time    | Content-hashed icon names, and the service worker with its precache manifest     |

A module's directory names its environment, and its `tsconfig.<environment>.json` lists it explicitly:

| Directory         | Project                | Globals and imports           |
| ----------------- | ---------------------- | ----------------------------- |
| none of the below | `tsconfig.pure.json`   | ES2022 only                   |
| `phaser/`         | `tsconfig.phaser.json` | ES2022, DOM and Phaser        |
| `dom/`            | `tsconfig.dom.json`    | ES2022 and DOM, no Phaser     |
| `vite/`           | `tsconfig.vite.json`   | ES2022, Node and Vite, no DOM |

Each compilation rejects the other environments' ambient globals, and ESLint rejects imports across them: pure modules import no environment directory, `dom/` imports no Phaser or `vite/`, `vite/` imports no Phaser or `dom/`, and nothing outside `vite/` imports Vite. `web/<area>/` holds website infrastructure in the same layout: pure policy such as headers, cache policy and precache lists at the top, browser bindings in `dom/` and build plugins in `vite/`. Public paths mirror source paths, for example `@andornaut/game-kit/web/headers/vite/securityHeadersPlugin`. The combined test/config project has the development types it needs.

## Integration contracts

- **Input:** callers supply event coordinates, timestamps, equality, hold thresholds, drag/fling tuning and reduced-motion policy. Clients perform returned actions and apply modal gates to their input routes.
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks and randomness. `motion` re-exports the `Point` type from `rect`.
- **Pixel fonts:** `PixelFontContext` supplies glyph bits, widths, height, spacing and space width. The kit returns geometry and advances; clients own glyph definitions and normalization. Phaser registration takes explicit font options and throws an `Error` naming the key when that texture key is invalid or already in use without a cached font.
- **Progress:** `undefined` means an unknown total, drawn as a static centred segment; finite progress is clamped to zero through one. `createProgressState` replaces the previous operation on `begin`; stale handles cannot update or finish its replacement. Clients own visibility, labels and timing and clear Phaser graphics.
- **Rendering:** `mountModalBackdrop(context, area)` owns its unique texture and display object and exposes `ready` and `destroy()`. It falls back when snapshot capture rejects. `snapshotRemapped` reads the area at the WebGL renderer's post-render point with Phaser's snapshot geometry, row order and un-premultiplication, or through `snapshotArea` on the Canvas renderer, and writes the remapped pixels into a canvas texture. The client owns modal layout, input and pausing.
- **Saves:** games own keys, schemas, validation and migration policy. Newer stored versions are preserved; corrupt saves are backed up before replacement. Failed reads or backups disable writes for the session. Failed writes may be retried. Encoding and JSON serialization failures return `invalid` without writing. `SaveStorage` is the parent adapter's port; `memoryStorage` is its pure in-memory implementation.

## High-density game UI

Callers supply font faces, source metrics, image sources, surfaces and lifecycle policy, and keep game-owned input, hierarchy and clocks.

| Module                     | Contract                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view/phaser/uiProjection` | Maps the canvas CSS size and an explicit device pixel ratio to an integer backing size.                                                                                                                                                                                                                                                                                                  |
| `view/phaser/uiSubmitter`  | `createUiRecorder` atomically registers sibling roots through public Phaser render roles, after the caller's font readiness promise, and rejects unsupported groups without partial routing. Refresh and disposal restore only still-owned roles. Glyph pens and baselines come from public glyph data and submitted quads, keeping signed bearings without measuring or reflowing text. |
| `view/phaser/uiCommands`   | `presentUi` replays ordered text runs, raster quads and uniform triangles with camera viewport clips. Tinted `ImageBitmap` and `HTMLImageElement` quads are cached (256 entries, 4 Mi pixels) and evicted through `releaseSurface`; canvas sources are tinted on every draw. `releaseUiTintCache(ports)` releases the rest at teardown.                                                  |
| `view/phaser/uiComposite`  | Checks same-frame default-framebuffer readback, including GL errors, flips rows and normalizes declared alpha. Excludes requested owners before UI replay and applies the supplied remap once. Masks, effects, gradients and non-normal blends are unsupported.                                                                                                                          |

Parents own the inert sibling canvas, render-event wiring, modal plane placement and combined visual verification.

## Terrain

### Traversal

`terrain/traversal` exports `stepTraversal(context, input, state)` and `findTraversal(context, request)`. Runtime and search run the same fixed-step finite-AABB kernel, so a `found` witness replays.

- **Kernel:** immediate horizontal intent; fixed-step gravity, jump and fall; swept solid side and ceiling clipping; moving-solid push and carry. Ledges block only downward relative crossings, without snapping from below. Safe grounding needs full-foot support and body clearance, and the goal is a landing corridor containing the complete body.
- **Caller supplies:** resolved pixels/second, absolute seconds, body size and offset, profile, timestep, bounds, drop limit, `maxCollisionSteps` and swept-body hazard predicates. `sampleColliders(timeSeconds, dtSeconds, queryBounds)` returns complete swept-entrant coverage with stable opaque ids, solid or ledge kinds and before/after rectangles. Ordinary mover endpoints describe the exact discrete tick path, even for nonlinear easing; graph movers supply contiguous absolute-time segments; unknown reactive futures return `complete: false`. Callers keep self-exclusion, snapshot ordering, caches and pursuit policy.
- **Budget and results:** `TraversalBudget` supplies finite `horizonSteps`, `maxStates` and `maxSteps`. Results are `found` (timestamped inputs), `unreachable` within the exhaustively searched domain, `budget-exhausted` (`states`, `steps` or `collision`) and `geometry-unavailable`. A failed step returns the original state with no committed segments. Mixed-motion support unions do not establish safe grounding, and pushes beyond sampled geometry return `geometry-unavailable`. Revalidate every executed step against current geometry.
- **Preferred inputs:** `TraversalRequest.preferredInputs` is one optional sequence of `TraversalCommand` values, tried before the regular search and validated whole first (at most `horizonSteps` long, move -1, 0 or 1, boolean jump, any `timeSeconds` property, own or inherited, rejected with `RangeError`); clocks come from the request time and timestep, and an empty sequence changes nothing. Its kernel calls, including failed ones, and its states spend the shared budgets. A blocked, unsafe or out-of-bounds step, or a sequence ending without the goal, falls back to the original start without refunding work and never establishes `unreachable`; incomplete geometry and collision-budget exhaustion return at once.

Frontier ordering is deterministic; its priority and tie-breaks are commented in the search core of `src/terrain/traversal.ts`.

### Immutable traversal worlds

Overloads taking `WorldTraversalContext`, `WorldTraversalState` and `WorldTraversalRequest` carry an immutable `world` through a `TraversalWorldAdapter`:

| Member            | Contract                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beginStep`       | Prepares the phase at the actual tick start, before collider sampling; pure and idempotent at that boundary. Geometry and safety use that snapshot.                                                                                  |
| `endStep`         | Receives the tick-end time, full body and all resolved standing-support ids in collider order, and records contact changes for the next boundary.                                                                                    |
| `sampleColliders` | Snapshot-specific geometry.                                                                                                                                                                                                          |
| `safe`            | Returns `"safe"`, `"unsafe"` or `"unavailable"`.                                                                                                                                                                                     |
| `key`             | Equal keys imply identical future behaviour: include phases, deadlines, pending and standing contacts and any branch-varying state, as stable opaque ids rather than lossy object strings. Deduplication and budget charging use it. |

Hooks return `TraversalAvailability<World>`; unknown geometry, occupancy or actor futures yield `geometry-unavailable`, never an empty contact set or safe geometry. Adapters supply known other-actor contacts and occupancy, substituting the planned actor's hypothetical body. A failed step returns the original body and world; global phase advancement belongs to the runtime caller and is not rolled back. Arrival validation prepares the world and rechecks standing support, clearance and safety; a found result carries that prepared snapshot, so witness replay includes final boundary preparation and terminal validation.

### Crumbling supports

`terrain/crumbling` exports `beginCrumblingStep(context, request, world)` and `endCrumblingStep(request, world)`, pure transitions for a traversal world adapter. Callers provide finite positive warning and absence durations, full collider volumes, actor and support ids and occupancy queries; there are no gameplay defaults.

- Phases are `intact`, `warning` and `absent`, and change only at tick starts, in active-world seconds, at the first boundary at or after a deadline. A paused clock cannot advance them.
- Old deadlines take precedence. Warning expiry removes support for the whole tick, and absence starts at that boundary.
- An absent support restores only when its full volume is clear of all bodies; occupied retries next tick, unknown returns unavailable.
- A new standing contact on an intact support latches one warning at the next boundary, and its duration starts there. More contacts or stepping off cannot cancel or extend it, and restoration alone cannot trigger one.
- The adapter assembles complete other-actor contacts and full-volume occupancy, including the substituted branch body, before calling these transitions.

### Movement and air maps

| Module                | Builds                                                                                                                                                                             | Queries                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `terrain/movementMap` | `buildMovementMap(options, profile, area)`: ground spans; `walk`, `jump`, `drop`, `wall-top`, `climb` and `track-climb` edges witnessed by the kernel; Dijkstra queries on seconds | `locate`, `pathTo`, `nearestReachable`, `reachableSet`, `sinks`; `mapCanonical`, `mapHash`                 |
| `terrain/airMap`      | `buildAirMap(options, profile, area)`: flyer cell grid, `fly` edges and perch `land`/`lift`; A\* queries with an axis-change penalty                                               | `locateAir`, `airPath`, `nearestReachableAir`, `reachableAir`, `sinksAir`; `airMapCanonical`, `airMapHash` |

Node and edge construction, window clipping and the canonical line format are documented on `buildMovementMap`, `mapCanonical`, `buildAirMap` and `airMapCanonical`. Caller contracts common to both:

- Built geometry is static. Movers, crumbling supports and timed hazards stay with the caller, which names them through `deps` and disables them per query through the mask. Invalid input throws `RangeError`.
- An optional `window` builds only the part of the map inside it; ids belong to one map, so carry positions between maps as hitboxes through `locate` or `locateAir`. In an air map window, a path costs the same as the full map's when the full map's least-cost path lies inside it; rebuild around the subject when it or its goal nears the window's edge.
- Area callbacks (`blocked`, `deps` and the movement map's `kind`) must be pure: builds call them in no promised order and skip states they can prove produce no edge.
- Queries are pure and cache nothing: cache per (from, goal, mask key). Ties go to the lower node id.
- Hashes are FNV-1a 64 of the canonical form; build and queries use no `Math.random`, `Date` or `performance`.

## Achievements

`achievements` judges a game's badge catalogue, orders and awards badges, keeps the earned record in its own versioned save (so a progress reset keeps it) and queues unlock notices. The game owns the condition union, scopes, facts, tiers, strings, art, tracking points and storage keys and versions. `achievements/preview` previews the badges ending the run now would earn, each at most once a run and without awarding. Push the loaded record's `unannounced` ids into `CelebrationQueue` at start, and call `announced` when a notice starts. Progress rules, ordering and store semantics are documented in `src/achievements.ts` and `src/achievements/preview.ts`.

## Utility scoring

`ai/utility` scores candidate actions as `gate × base × Π curveValue × multiplier` and chooses one with hysteresis and a single seeded draw among near-equal scores, so replays from the same seed and inputs choose the same actions. Games own the inputs, actions, values and behaviour. Curves, hold rules and result reasons are documented in `src/ai/utility.ts`.

## Numbers and text measurement

- `numbers.clamp(minimum, maximum, value)` does not reorder bounds and propagates NaN; `lerp` does not clamp. See `src/numbers.ts`.
- `text/bitmapFont.advanceWidth` measures pen advance, including trailing whitespace; `inkWidth` measures inked columns. See `src/text/bitmapFont.ts`.

## Standalone verification

```bash
npm run verify
```

`npm run verify` runs `node scripts/check.ts`, which CI also runs. The host needs Docker, Git and the Node version in `.nvmrc`, which runs the TypeScript tooling without a build step and names the container image. The gate starts only below one-minute load 24 and uses at most four CPUs and four Vitest workers. It installs dependencies offline from the npm cache and checks types, formatting, lint and tests in a container without network access. If the offline install fails, it populates the cache in a networked container and repeats the offline gate. It then packs the committed revision as `scripts/pack.ts` does and checks that tarball in another offline container: its file list, manifest and exports, native Node imports without peers, declarations under `NodeNext`, and a parent Vite configuration that loads the kit's plugins. Uncommitted changes reach the tarball checks only once committed. `node scripts/check.ts <directory>` keeps the checked tarball, `SOURCE_COMMIT` and `SHA256SUMS` in that directory. Source fingerprints must not change during the run, and credential-shaped paths are refused before their contents are read.

Every container runs as uid and gid 19001, which owns nothing on the host, with the group of each mounted checkout added for reads, `HOME=/tmp`, a read-only root file system and only read-only host mounts. Scratch and outputs live in a per-run volume; results are copied out with `docker cp`, so files in the checkout keep their host owner. The gate masks ignored `.claude/` state and `.worktrees/` role worktrees; ESLint ignores both. When the gate fails, it keeps the release artifacts and their consumer probe in `.claude/artifact-check.*` and prints the path; a passing gate deletes them. The npm cache is the named Docker volume `game-kit-npm-cache`; `GAME_KIT_NPM_CACHE` names another. `node scripts/npm-cache.ts load|save <directory>` streams a host directory into the volume through a container, or copies the volume out with `docker cp`; CI uses it to carry the cache between runs, keyed on the `package-lock.json` hash.

| Container command            | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `npm run check`              | Check combined and per-environment types concurrently |
| `npm run lint`               | Check formatting, ESLint boundaries and Markdown      |
| `npm test -- --maxWorkers=4` | Run canonical unit and contract tests                 |
| `npm run format`             | Format a writable checkout                            |

WORKAROUND: Parent-scoped development overrides pin [KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) `0.18.2`, [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) `11.0.3` and [re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) `2.8.7`. ESLint loads cycle detection and its resolver through exported plugin subpaths because the full plugin imports an unused rule requiring minimatch's removed `makeRe` API. Keep cycle detection enabled. Remove each override when its parent supports the patched version; restore the full plugin import when it supports minimatch 11.

## Release artifacts and consumer proof

[GitHub releases](https://github.com/andornaut/game-kit/releases) distribute `game-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS`; there is no npm registry publication.

`node scripts/pack.ts <output-directory>` builds the committed revision in an offline container from the npm cache volume. It compiles JavaScript and declarations with `tsconfig.release.json` and packages the manifest, `SOURCE_COMMIT`, README and licence, without TypeScript source, tests, scripts or development commands. It is the only release builder: the gate checks its tarball, and CI runs `node scripts/check.ts .claude/release-output` and uploads the files it checked. `SOURCE_DATE_EPOCH` is the commit time, so a rebuild of the same commit yields the same `SHA256SUMS`.

```bash
GAME_KIT_ARCHIE_CACHE=<Archie-npm-cache> GAME_KIT_CHIBI_CACHE=<Chibi-npm-cache> \
node scripts/check-release-consumers.ts \
  <artifact.tgz> <sha256> <source-commit> \
  <Archie-repository> <Archie-revision> <Chibi-repository> <Chibi-revision>
```

The proof installs the exact artifact into immutable snapshots of both games' pinned revisions, offline. It checks that the installed bytes and lockfile integrity match the tarball, that each game's kit imports resolve into it, each game's type check and Vite and Vitest configuration, and runs each game's `test:game-kit` npm script, which tests its kit wiring; a snapshot without that script fails. It never edits a checkout or builds or deploys a game. `GAME_KIT_ARCHIE_CACHE` and `GAME_KIT_CHIBI_CACHE` are required and name each game's populated offline npm cache, mounted read-only. Logs, archive listings and results are kept in the printed evidence directory. The tarball's own exports, native imports and declarations are checked by the gate, on the same bytes.

Tag a release only after every required workflow is green for that `main` commit and the artifact passes the consumer proof. Tags and release assets are never moved.

## Licence

[MIT](LICENSE) covers helper code. Consuming games retain their own art, font and content licences.
