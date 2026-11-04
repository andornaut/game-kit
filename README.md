# game-kit

Game-independent TypeScript mechanisms, Phaser adapters and website infrastructure. Games supply content, strings, palettes, dimensions, schemas, tuning, policies and lifecycle. Parent projects own their asset tooling and wire `web/*` modules into their own pages and Vite configuration.

## Importing

Import individual public modules without an extension:

```ts
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/random";
import { memoryStorage, type SaveStorage } from "@andornaut/game-kit/save/storage";
```

The compiled GitHub release archive contains JavaScript and declarations. Install its versioned URL and commit the consumer lockfile with URL and integrity. No npm registry publication or source aliases are required. `SOURCE_COMMIT`, inside the archive and alongside it, records the exact source revision. Tests and standalone scripts are private. Pure imports need no runtime peers; Phaser adapters require the consuming game's `phaser` dependency, `web/**/vite/*` modules its `vite` dependency, `web/build/vite/phaserUses` its `typescript` dependency and `web/build/vite/gameConfig` its `vitest` dependency.

## Version and interface policy

The source package is version `0.9.0`. The explicit `exports` map and exported declarations define the public interface. Internal imports are relative and acyclic; there is no root barrel loading an engine for pure callers.

Compatible fixes use patch versions; additive public facilities use minor versions. After 1.0, incompatible changes require a major version. Before 1.0, incompatible changes require a minor version and an explicit migration. Update the manifest and root lockfile together. Prove the compiled artifact against exact consumer revisions before publication. Documentation-only changes need no version bump.

## Migration to 0.10.0

These public paths are removed. Their modules remain internal to the kit, so behaviour is unchanged:

- `input/tapGuard` (`guardPassed`): use `input/phaser/guardSceneInput`, which applies the guard.
- `text/phaser/uiGlyphPen` (`uiGlyphPen`): `view/phaser/uiSubmitter` derives glyph pens itself.

## Addition in 0.9.0

`web/*` replaces the `src/platform/` code each game copied from 0.3.x. Game-specific values, such as page rules, header policies and page checks, are parameters. Adopting it is optional per module: replace a copied module's imports with its `web/*` path and delete the copy.

- `web/headers/securityHeaders` keeps the copied interface, except that `cspHash(text)` is now `sha256Source(base64Digest)` and `unhashedAssets(context, fileNames)` takes the content-hashed name pattern (`VITE_HASHED_NAME` for Vite's default) as its second argument. Hashing moved into the Vite plugin.
- `web/headers/vite/securityHeadersPlugin` takes the same options plus an optional `hashedName`, and also builds without a public directory.
- `web/pwa/dom/visibility` defines `VisibilitySource`, takes `watchVisibility(eventTarget, visibilitySource, onChange)` and returns a function that removes its listeners.
- `web/save/storage` holds the pure `StorageLike`, `browserStorage` and `lazyStorage`, and `web/save/dom/localSaveStorage` holds `localSaveStorage()`. `StorageLike` is a structural interface instead of `Pick<Storage, ...>`. Neither re-exports `SaveStorage`: import it from `save/contracts` or `save/storage`, which also exports `memoryStorage`.
- `web/save/dom/pageSessionStore` keeps `sessionRead`, `sessionWrite` and `sessionRemove` over the page's `sessionStorage`. Their policy is `web/save/sessionStore.createSessionStore(lookup)`, which accepts any `SessionStorageLike`.
- `web/view/frameTurn` holds the pure turn policy: `GameOrientation`, `FRAME_TURN_ATTRIBUTE`, `DEFAULT_TURN`, `turnedFrameQuery` and `frameTurnFor`. `web/view/dom/watchFrameTurn` holds `FrameTurnHost`, `FrameTurnWatch` and `OrientationLockable`, and takes the game orientation first: `watchFrameTurn(gameOrientation, host)` and `lockGameOrientation(gameOrientation, screen)`. The stylesheets are `web/view/frameTurnLandscapeGame.css` and `web/view/frameTurnPortraitGame.css`. `FrameTurn` and `pageToGame` remain in `view/pagePoint`.
- `web/view/phaser/followFrameTurn` takes `followFrameTurn(watch, gameSize, parent, game)`, the game last. It lives under `web/` because it owns the page viewport lifecycle (window, document and visual viewport listeners and the `--page-height` property the stylesheets read) and depends on `web/view/dom/watchFrameTurn`; `view/` keeps geometry and engine adapters with no website imports.
- `web/build/buildLabel` exports only `buildLabel(version, commit)`; the ambient `BUILD_LABEL` constant is gone. Kit modules take build values as parameters. `web/build/vite/buildInfo` is a types-only export declaring `__APP_VERSION__` and `__COMMIT__`, the constants `gameViteConfig` defines; a game that reads them references it with `/// <reference types="@andornaut/game-kit/web/build/vite/buildInfo" />`.
- `build/buildVersion` splits by environment: pure `web/build/buildVersion` keeps `shortCommit`, `UNKNOWN_COMMIT` and `CI_COMMIT_VARIABLE`, and `gitHead` moves to `web/build/vite/gitHead`.
- `build/phaserBuild` splits the same way: `phaserSourceDir` moves to `web/build/vite/phaserSource`, and the rest is pure `web/build/phaserBuild`. `phaserEntrySource` joins module paths with `/`. `contentHash`, `phaserUses`, `phaserBuildPlugin` and `gameConfig` move to `web/build/vite/*` unchanged.
- `web/crash/dom/crashScreen` takes the page explicitly: `installCrashScreen(page, options)`, where `page` is the game window (`CrashPage`). Import `web/crash/dom/crash.css` from the game, since a script cannot add styles under a CSP without `'unsafe-inline'`. `web/crash/crashModel` is unchanged.
- `web/input/dom/pagePresses` and `web/progress/dom/progressBar` are unchanged apart from their paths.
- `web/pwa/*` keeps the copied interfaces except as listed here. Modules are placed by environment: `appWindow`, `cachePolicy`, `hashedIcons`, `installState`, `precacheList`, `serviceWorkerUrl` and `storagePersistence` are pure; `audioUnlock`, `exitApp`, `installButton`, `installFlow`, `offlinePlay`, `serviceWorker` and `wakeLock` are under `dom/`, and `hashedIconsPlugin` and `precachePlugin` under `vite/`.
- `backNavigation` and `updateReady` are split. `web/pwa/backNavigation` holds `backGuardState`, `BACK_GUARD_GESTURES`, `backCloseWatcher`, `INSTALLED_APP_DISPLAY_QUERY`, `isFirefoxAndroidApp` and the newly exported `isBackGuardState` and `ESCAPE_KEY`; `web/pwa/dom/backNavigation` holds the history, close-watcher and timer types, `browserCloseWatcher` and `guardBackNavigation`. `web/pwa/updateReady` holds `updateAction`, `resumeCheckDue`, `RESUME_CHECK_MS`, `SKIP_WAITING_MESSAGE` and the state and option types; `web/pwa/dom/updateReady` holds the service worker types, `newerVersionOf`, `activateWaitingWorker`, `createUpdateFlow` and `registerWhenDue`.
- `appCannotClose(createCloseWatcher, host)` accepts any factory, `(() => unknown) | undefined`, since it reads only whether there is one.
- `createScreenWakeLock(eventTarget, visibilitySource, wakeLock)` takes the page window first and follows `watchVisibility`, so `pagehide` also releases the lock. `VisibilitySource` comes from `web/pwa/dom/visibility`.

## Migration to 0.8.0

- `UiFrame.commands` now holds fewer commands; painted pixels are unchanged. Consecutive glyphs from one `BitmapText` with the same face, size, tint, tint mode and alpha share one text command, listed in its `glyphs`. A `viewport-clip` command is emitted only when the camera or its viewport rect changes, and stays in effect for every later command until the next one. Consumers that count commands per glyph or expect a clip before every command must iterate `glyphs` and track the latest clip. `releaseUiTintCache` is a new export.
- `view/phaser/snapshotRemap` reads WebGL pixels directly instead of through a PNG round trip. Opaque pixels are unchanged; translucent pixels now match Phaser's own readback, so a canvas with alpha can differ slightly from 0.7.
- `text/phaser/registerPixelFont` throws an `Error` naming the key when the texture key is invalid or already in use without a cached font, instead of returning without registering. Use a key no other texture uses.
- `view/phaser/modalBackdrop` and `view/phaser/snapshotRemap` now import `phaser` at runtime, as `clock/phaser/capFrameRate` and `input/phaser/guardSceneInput` already do. Vitest externalizes dependencies, so a consumer test that replaces Phaser with `vi.mock("phaser")` must inline the kit with `test.server.deps.inline: ["@andornaut/game-kit"]`; otherwise the kit loads the real Phaser.

## Migration to 0.4.0

This is an incompatible game-only boundary change. Both parents must use their own migrated website and tooling implementations before adopting this version. Existing immutable 0.3.x artifacts remain usable by older clients.

| Removed public surface                                                                              | Owner after migration                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `art/atlasBuild`, `art/atlasLayout`, `art/png`, `art/webp`                                          | Parent asset tooling                        |
| `build/*`, including `build/buildInfo`                                                              | Parent build configuration and declarations |
| `crash/*`, `headers/*`, `pwa/*`                                                                     | Parent website and PWA integration          |
| `input/pagePresses`, `progress/dom/progressBar`, `sessionStore`                                     | Parent page bindings                        |
| `save/storage` browser adapters: `StorageLike`, `browserStorage`, `lazyStorage`, `localSaveStorage` | Parent persistence adapter                  |
| `view/frameTurn`, its stylesheets and `view/phaser/followFrameTurn`                                 | Parent viewport/CSS/pointer orchestration   |

`save/storage` remains a public path exporting `memoryStorage` and the `SaveStorage` type. `save/contracts`, `save/saveStore` and `save/versionedSave` remain unchanged in ownership. Pure `view/fitCheck`, `view/pagePoint` and `view/settleFit` remain available; the library provides no replacement page orchestration. Parameter order of retained public functions is unchanged.

Source-vendor sync, its historical nested-layout handling and the source-snapshot compatibility command are retired. Use the compiled-artifact proof described below. No replacement website package is supplied. Parent copies retain their helper-code MIT notices; game assets keep their own licences.

## Modules and environments

Paths are relative to `src/`. The source tree contains game mechanisms and their colocated canonical tests.

| Modules                                                                                                           | Environment              | Responsibility                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `arrays`, `assertNever`, `lines`, `maps`, `numbers`, `opaqueBounds`, `random`, `records`, `rect`, `rgba`, `units` | Pure                     | Collections, text fields, geometry, randomness, pixels and units                 |
| `art/aseprite`, `art/rgbaImage`                                                                                   | Pure                     | Animation specifications and RGBA primitives                                     |
| `clock/fixedStep`, `clock/frameCap`                                                                               | Pure                     | Fixed-step timing and frame-cap decisions                                        |
| `input/*` except `input/phaser/*`, `modalLayout`                                                                  | Pure                     | Press, hold, scroll, gesture and modal state                                     |
| `motion`                                                                                                          | Pure                     | Immutable motion segments and easing                                             |
| `progress`, `progressState`                                                                                       | Pure                     | Bar geometry and operation state                                                 |
| `save/*`                                                                                                          | Pure                     | Storage contract, memory implementation, versioning and save coordination        |
| `terrain/crumbling`, `terrain/traversal`                                                                          | Pure                     | Fixed-tick support lifecycle, bounded search and shared collision stepping       |
| `text/*` except `text/phaser/*`                                                                                   | Pure                     | Bitmap font metrics, fixed-size wrapping, overflow and pixel atlas geometry      |
| `view/fitCheck`, `view/modalDim`, `view/pagePoint`, `view/settleFit`                                              | Pure                     | Fit decisions, palette dimming, coordinate mapping and bounded settling          |
| `web/build/buildLabel`, `web/build/buildVersion`, `web/build/phaserBuild`                                         | Pure                     | Build labels, commit selection, reduced Phaser entries and feature flags         |
| `web/crash/crashModel`                                                                                            | Pure                     | Crash classification and presentation data                                       |
| `web/headers/securityHeaders`                                                                                     | Pure                     | Content-Security-Policy rules and Cloudflare `_headers` rendering                |
| `web/pwa/*` except `web/pwa/dom/*` and `web/pwa/vite/*`                                                           | Pure                     | App window, install, back guard, caching, precache, icons, storage and updates   |
| `web/save/sessionStore`, `web/save/storage`                                                                       | Pure                     | Never-throwing session store and Web Storage save adapters                       |
| `web/view/frameTurn` and its `frameTurn*Game.css` stylesheets                                                     | Pure, CSS                | Page frame turn policy and the turned-frame stylesheets                          |
| `clock/phaser/*`, `input/phaser/*`, `progress/phaser/*`, `text/phaser/*`, `view/phaser/*`                         | Phaser, browser renderer | Frame caps, input guards, progress drawing, fonts, snapshots and modal backdrops |
| `web/view/phaser/followFrameTurn`                                                                                 | Phaser, browser renderer | Phaser fitting and pointer mapping through the page frame turn                   |
| `web/crash/dom/crashScreen`, `web/crash/dom/crash.css`                                                            | Browser DOM              | Crash screen in the game's words and colours, and its stylesheet                 |
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
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks and randomness. `motion/Point` is a compatibility export of `rect/Point`.
- **Pixel fonts:** `PixelFontContext` supplies glyph bits, widths, height, spacing and space width. The kit returns geometry and advances; clients own glyph definitions and normalization. Phaser registration takes explicit font options and throws an `Error` naming the key when that texture key is invalid or already in use without a cached font.
- **Progress:** `undefined` means an unknown total, drawn as a static centred segment; finite progress is clamped to zero through one. `createProgressState` replaces the previous operation on `begin`; stale handles cannot update or finish its replacement. Clients own visibility, labels and timing and clear Phaser graphics.
- **Rendering:** `mountModalBackdrop(context, area)` owns its unique texture and display object and exposes `ready` and `destroy()`. It falls back when snapshot capture rejects. `snapshotRemapped` reads the area at the WebGL renderer's post-render point with Phaser's snapshot geometry, row order and un-premultiplication, or through `snapshotArea` on the Canvas renderer, and writes the remapped pixels into a canvas texture. The client owns modal layout, input and pausing.
- **Saves:** games own keys, schemas, validation and migration policy. Newer stored versions are preserved; corrupt saves are backed up before replacement. Failed reads or backups disable writes for the session. Failed writes may be retried. Encoding and JSON serialization failures return `invalid` without writing. `SaveStorage` is the parent adapter's port; `memoryStorage` is its pure in-memory implementation.

## High-density game UI

`view/phaser/uiProjection` maps the actual canvas CSS size and explicit device pixel ratio to an integer backing size. `view/phaser/uiSubmitter.createUiRecorder` atomically registers sibling roots through public Phaser render roles, retaining game-owned input, hierarchy and clocks. Registration waits for the caller's exact font readiness promise and rejects unsupported groups without partial routing. Refresh and disposal restore only still-owned roles.

`view/phaser/uiCommands.presentUi` replays ordered text runs, raster quads and uniform triangles with camera viewport clips. Tinted quads from an `ImageBitmap` or a loaded `HTMLImageElement` are cached by release port, image, source rectangle, tint and tint mode, up to 256 entries and 4 Mi retained pixels; canvas sources are tinted on every draw. Evicted surfaces return through `releaseSurface`, and `releaseUiTintCache(ports)` releases the remaining ones at teardown. `uiSubmitter` derives source-font pen and baseline transforms from public glyph data and submitted quads, preserving signed bearings without measuring or reflowing text. Callers supply font faces, source metrics, image sources, surfaces and lifecycle policy.

`view/phaser/uiComposite` checks same-frame default-framebuffer readback, including GL errors, flips rows and normalizes declared alpha. Compositing excludes requested owners before UI replay and applies the supplied remap once. Parents own the inert sibling canvas, existing render-event wiring, modal plane placement and combined visual verification. Masks, effects, gradients and non-normal blends are unsupported.

## Terrain traversal

`terrain/traversal` exports `stepTraversal(context, input, state)` and `findTraversal(context, request)`. Runtime and search execute the same finite-AABB kernel: immediate horizontal intent, fixed-step gravity/jump/fall, swept solid side/ceiling clipping and moving-solid push/carry. Ledges block only downward relative crossings, without snapping from below. Safe grounding requires full-foot support and body clearance. The goal is a landing corridor containing the complete body.

Callers supply resolved pixels/second, absolute seconds, body dimensions/offset, profile, timestep, bounds, drop limit, collision iteration limit and swept-body hazard predicates. `sampleColliders(timeSeconds, dtSeconds, queryBounds)` returns complete swept-entrant coverage with opaque stable identities, solid/ledge kinds and before/after rectangles. Ordinary mover endpoints describe the exact discrete tick path even for nonlinear authored easing; graph movers supply contiguous absolute-time segments. Unknown reactive futures return `complete: false`. Callers retain self-exclusion, snapshot ordering, caches and pursuit policy.

`TraversalBudget` supplies finite `horizonSteps`, `maxStates` and `maxSteps`; `maxCollisionSteps` is explicit in context. Results distinguish a replayable `found` witness, `unreachable` within the exhaustively searched finite domain, `budget-exhausted` and `geometry-unavailable`. Step failures return the original state with no committed segments. Mixed-motion support unions do not establish safe grounding; pushes beyond sampled geometry return `geometry-unavailable`. Revalidate every executed step against current geometry.

Frontier priority combines the horizontal full-body goal gap and any gap below the goal. Zero vertical speed above the goal adds a wrong-height contact cost; ascent adds none. A query-local heap caches each immutable state's score. Deeper states win ties, then the latest insertion wins, matching stable sort followed by pop. Exact states at different times remain distinct, preserving waits for moving geometry; ordering adds no geometry or physics calls.

`TraversalRequest.preferredInputs` optionally supplies one readonly sequence of `TraversalCommand` values (`Pick<TraversalInput, "move" | "jump">`). Clocks are derived from the request time and context timestep. The whole sequence is validated before callbacks: length cannot exceed `horizonSteps`, move must be -1, 0 or 1, and jump must be boolean. A `timeSeconds` property, own or inherited and even valued `undefined`, is rejected with `RangeError`; other extra properties are allowed. Omitted or empty sequences preserve the existing search trace.

The initial goal and every eligible preferred state use the normal full-body terminal validation. The first valid goal returns timestamped inputs. Every attempted kernel call, including a failed one, spends the shared step budget; distinct depth/state/support keys across both phases spend the shared state budget, with the initial state counted once. Step capacity is checked before a call and state capacity before admitting a new successful state. A blocked, unsafe or out-of-bounds preferred step, or a sequence ending without a goal, falls back to the original start and time without resetting spent work. Preferred accounting never prunes the fresh regular frontier, and repeated execution still spends steps. Incomplete geometry and collision-budget exhaustion propagate immediately. Preferred failure alone never establishes `unreachable`.

### Immutable traversal worlds

The optional overloads accept `WorldTraversalContext<Id, World>`, `WorldTraversalState<Id, World>` and `WorldTraversalRequest<Id, World>`. The state carries an immutable `world`. `TraversalWorldAdapter` supplies `beginStep`, `endStep`, `key`, snapshot-specific `sampleColliders` and tri-state `safe`. Existing stateless overloads and preferred-command contracts remain unchanged.

`beginStep(world, request)` prepares the phase at the actual tick start before collider sampling; it must be pure and idempotent at that boundary. Geometry and safety use that snapshot for the entire tick. After successful physics, `endStep` receives the absolute tick-end time, full body and all resolved standing-support IDs in collider order. It records contact changes for the next boundary. A failed step returns the original body/world state with no committed segments. The runtime caller separately owns global phase advancement, which a failed actor transaction cannot roll back.

Lifecycle hooks return `TraversalAvailability<World>`. World safety returns `"safe"`, `"unsafe"` or `"unavailable"`; unknown geometry, occupancy or actor futures propagate `geometry-unavailable`. Adapters explicitly supply known other-actor future contacts and occupancy, replacing the planned actor's actual body with its hypothetical body. Unknown data must not become an empty contact set or safe geometry.

Both regular deduplication and shared preferred/regular charging include `world.key(world)`. Equal keys must imply identical future behaviour: include phases, deadlines, pending contacts, standing-contact memory, boundary preparation and any branch-varying external state. Use stable opaque identities without lossy object stringification. Preferred fallback restores the original body/world root while retaining spent work. Arrival validation prepares the world and rechecks actual standing support, clearance and safety. A found result carries that prepared arrival snapshot; witness replay must include final boundary preparation and terminal validation.

### Crumbling supports

`terrain/crumbling` exports `beginCrumblingStep(context, request, world)` and `endCrumblingStep(request, world)`. `CrumblingWorld` stores support phases (`intact`, `warning`, `absent`), deadlines, standing contacts, pending contacts and the last prepared boundary. Callers provide finite positive warning/absence durations, full collider volumes, actor/support identities and occupancy queries. No gameplay timing defaults are supplied.

At tick start, old deadlines take precedence. Warning expiry removes support for the entire tick; absence duration starts at that removal boundary. Eligible absent supports restore only when the full collider volume is clear of all physical bodies. Occupied supports retry at the next tick start; unknown occupancy returns unavailable. There are no sub-tick lifecycle events. Deadlines use active-world seconds and take effect at the first boundary at or after the deadline; a paused clock cannot advance phases.

The complete resolved contact set at tick end records newly standing actor/support pairs. At the next boundary, a new contact on an intact support latches one warning. Additional contacts and stepping off cannot cancel or extend it. Warning duration starts at this consuming boundary. Restoration alone cannot trigger warning; a subsequent new landing can. The adapter assembles complete other-actor contacts and supplies full-volume occupancy, including the substituted branch body, before using these pure transitions.

## Numeric and text measurement contracts

`numbers.clamp(minimum, maximum, value)` evaluates `Math.min(maximum, Math.max(minimum, value))`. Bounds are not reordered: NaN propagates and reversed bounds return the maximum for non-NaN input. Preserve a caller's opposite nesting unless ordered bounds are established. `lerp(from, to, fraction)` evaluates `from + (to - from) * fraction` without clamping, sanitizing non-finite values or short-circuiting endpoints.

`text/bitmapFont.advanceWidth(font, scale, line)` measures pen advance, including trailing whitespace and kerning. Missing glyphs are skipped without replacing the previous known glyph. `inkWidth` measures visible columns and remains distinct.

## Standalone verification

```bash
node scripts/check.ts
```

The host needs Docker, Git and the Node version in `.nvmrc`, which runs the TypeScript tooling directly without a build step. The isolated gate uses Node 24.21.0, at most four CPUs and four Vitest workers. It installs dependencies offline from the project npm cache and checks types, formatting, lint, tests and the actual compiled package in a container without network access. Only when the offline install fails does it populate the cache in a networked container and repeat the offline gate. Source fingerprints must remain stable, and credential-shaped paths are refused before content reads. CI invokes the same script. Start below one-minute load 24. Container images derive from `.nvmrc`.

Every container runs as uid and gid 19001, which owns nothing on the host, with the group of each mounted checkout added for reads, `HOME=/tmp`, a read-only root file system and only read-only host mounts. Scratch and outputs live in a per-run volume; results are copied out with `docker cp`, so files in the checkout keep their host owner. The gate masks ignored `.claude/` state, where it retains artifact evidence, and ignored `.worktrees/` role worktrees; ESLint ignores both. The npm cache is the named Docker volume `game-kit-npm-cache`; `GAME_KIT_NPM_CACHE` names another. `node scripts/npm-cache.ts load|save <directory>` streams a host directory into the volume through a container, or copies the volume out with `docker cp`; CI uses it to carry the cache between runs, keyed on the `package-lock.json` hash.

| Container command            | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `npm run check`              | Check combined and per-environment types concurrently |
| `npm run lint`               | Check formatting, ESLint boundaries and Markdown      |
| `npm test -- --maxWorkers=4` | Run canonical unit and contract tests                 |
| `npm run format`             | Format a writable checkout                            |

TypeScript and Vitest are the kit's development tools. `@types/node` supplies tooling, test and `vite/` types. Phaser, TypeScript, Vite and Vitest are optional peers: Phaser for `phaser/` adapters, Vite for `vite/` modules, TypeScript for `web/build/vite/phaserUses` and Vitest for the configuration types of `web/build/vite/gameConfig`. Tests belong to the canonical library suite; consumers test their own integration. A consumer that mocks `phaser` in Vitest must inline `@andornaut/game-kit` (`test.server.deps.inline`), because every `phaser/` adapter may import Phaser at runtime.

WORKAROUND: Parent-scoped development overrides pin [KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) `0.18.2`, [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) `11.0.3` and [re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) `2.8.7`. ESLint loads cycle detection and its resolver through exported plugin subpaths because the full plugin imports an unused rule requiring minimatch's removed `makeRe` API. Keep cycle detection enabled. Remove each override when its parent supports the patched version; restore the full plugin import when it supports minimatch 11.

## Release artifacts and consumer proof

The public source repository is [andornaut/game-kit](https://github.com/andornaut/game-kit). GitHub releases distribute `game-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS`, without npm registry publication. Install only an actually published version and commit the lockfile integrity. The versioned artifact URL for `0.6.0` is `https://github.com/andornaut/game-kit/releases/download/v0.6.0/game-kit-0.6.0.tgz`.

`node scripts/pack.ts <output-directory>` builds the committed revision in an isolated offline container from the populated npm cache volume. It emits JavaScript and declarations using `tsconfig.release.json` and packages public metadata, provenance, README and MIT licence. Runtime TypeScript source, tests and private development commands are excluded. Library-owned verification, packaging and CI scripts remain private.

```bash
node scripts/check-release-consumers.ts \
  <artifact.tgz> <sha256> <source-commit> \
  <Archie-repository> <Archie-revision> <Chibi-repository> <Chibi-revision>
```

This proof checks immutable consumer snapshots with the exact compiled artifact, source revision and checksum. It validates installed bytes, lockfile integrity, every export, native imports and declarations, actual parent Vite/Vitest configuration bootstrap and focused client wiring. It never edits live checkouts or builds/deploys a game. Both pinned revisions must already use their parent-owned website/tooling implementations. Offline consumer caches are selected by `GAME_KIT_DOG_CACHE` and `GAME_KIT_DUCK_CACHE`. Logs, archive listings and results are retained in the printed evidence directory.

Publish immutable version tags only after every required workflow is green for that exact main commit and the artifact passes the pinned migrated-consumer proofs. Existing tags and release assets are never moved.

## Licence

[MIT](LICENSE) covers helper code. Consuming games retain their own art, font and content licences.
