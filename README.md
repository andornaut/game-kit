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

## Migration to 0.13.0

- `save/contracts` is removed. Import `SaveStorage` from `@andornaut/game-kit/save/storage`, which defines it.
- `web/pwa/vite/precachePlugin`: a public file the page links, or an icon a linked web app manifest names, that is missing from the public directory now fails the build instead of being left out with a warning. Add the file or remove the link.

## Migration to 0.12.0

- `web/pwa/cachePolicy`: `CachePolicy.revalidatedUrls` is now optional and ignored, and a later release removes it; delete it from each game's policy. The worker serves content-hashed build output and every sound file cache-first, and the page and every other precached file network-first, with the cached copy answering offline. An unhashed file can change under its name, so code that reads it must see the deploy the page came from. A file that was revalidated but is not precached is now network-only, so precache it to keep it offline. `cachedUrlsOf` returns `CachedUrls`, the precache list and the sound files as separate sets, which `strategyFor` takes in place of one set.
- `web/crash/dom/crashScreen`: Reload activates a waiting service worker before it reloads, when a worker controls the page, so the reload runs the newer version. Without a service worker, a waiting worker or a readable registration, it reloads at once.

## Addition in 0.11.0

`achievements` and `achievements/preview` are new pure modules; nothing existing changes. The earned store reports `saveStore` load and write statuses, and `progress` is never full while a badge is not earned. See [Achievements](#achievements).

## Modules and environments

Paths are relative to `src/`, and tests sit beside their modules. Every module is a public path except `input/tapGuard` and `text/phaser/uiGlyphPen`, which are internal.

| Modules                                                                                                           | Environment              | Responsibility                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `achievements`, `achievements/preview`                                                                            | Pure                     | Badge judging, tier order, awarding, the earned record and unlock notices        |
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

`view/phaser/uiProjection` maps the actual canvas CSS size and explicit device pixel ratio to an integer backing size. `view/phaser/uiSubmitter.createUiRecorder` atomically registers sibling roots through public Phaser render roles, retaining game-owned input, hierarchy and clocks. Registration waits for the caller's exact font readiness promise and rejects unsupported groups without partial routing. Refresh and disposal restore only still-owned roles.

`view/phaser/uiCommands.presentUi` replays ordered text runs, raster quads and uniform triangles with camera viewport clips. Tinted quads from an `ImageBitmap` or a loaded `HTMLImageElement` are cached by release port, image, source rectangle, tint and tint mode, up to 256 entries and 4 Mi retained pixels; canvas sources are tinted on every draw. Evicted surfaces return through `releaseSurface`, and `releaseUiTintCache(ports)` releases the remaining ones at teardown. `uiSubmitter` derives source-font pen and baseline transforms from public glyph data and submitted quads, preserving signed bearings without measuring or reflowing text. Callers supply font faces, source metrics, image sources, surfaces and lifecycle policy.

`view/phaser/uiComposite` checks same-frame default-framebuffer readback, including GL errors, flips rows and normalizes declared alpha. Compositing excludes requested owners before UI replay and applies the supplied remap once. Parents own the inert sibling canvas, existing render-event wiring, modal plane placement and combined visual verification. Masks, effects, gradients and non-normal blends are unsupported.

## Terrain traversal

`terrain/traversal` exports `stepTraversal(context, input, state)` and `findTraversal(context, request)`. Runtime and search execute the same finite-AABB kernel: immediate horizontal intent, fixed-step gravity/jump/fall, swept solid side/ceiling clipping and moving-solid push/carry. Ledges block only downward relative crossings, without snapping from below. Safe grounding requires full-foot support and body clearance. The goal is a landing corridor containing the complete body.

Callers supply resolved pixels/second, absolute seconds, body dimensions/offset, profile, timestep, bounds, drop limit, collision iteration limit and swept-body hazard predicates. `sampleColliders(timeSeconds, dtSeconds, queryBounds)` returns complete swept-entrant coverage with opaque stable identities, solid/ledge kinds and before/after rectangles. Ordinary mover endpoints describe the exact discrete tick path even for nonlinear authored easing; graph movers supply contiguous absolute-time segments. Unknown reactive futures return `complete: false`. Callers retain self-exclusion, snapshot ordering, caches and pursuit policy.

`TraversalBudget` supplies finite `horizonSteps`, `maxStates` and `maxSteps`; `maxCollisionSteps` is explicit in context. Results distinguish a replayable `found` witness, `unreachable` within the exhaustively searched finite domain, `budget-exhausted` and `geometry-unavailable`. Step failures return the original state with no committed segments. Mixed-motion support unions do not establish safe grounding; pushes beyond sampled geometry return `geometry-unavailable`. Revalidate every executed step against current geometry.

Frontier priority combines the horizontal full-body goal gap and any gap below the goal. Zero vertical speed above the goal adds a wrong-height contact cost; ascent adds none. A query-local heap caches each immutable state's score. Deeper states win ties, then the latest insertion wins, matching stable sort followed by pop. Exact states at different times remain distinct, preserving waits for moving geometry; ordering adds no geometry or physics calls.

`TraversalRequest.preferredInputs` optionally supplies one readonly sequence of `TraversalCommand` values (`Pick<TraversalInput, "move" | "jump">`). Clocks are derived from the request time and context timestep. The whole sequence is validated before callbacks: length cannot exceed `horizonSteps`, move must be -1, 0 or 1, and jump must be boolean. A `timeSeconds` property, own or inherited and even valued `undefined`, is rejected with `RangeError`; other extra properties are allowed. An omitted or empty sequence searches exactly as without one.

The initial goal and every eligible preferred state use the normal full-body terminal validation. The first valid goal returns timestamped inputs. Every attempted kernel call, including a failed one, spends the shared step budget; distinct depth/state/support keys across both phases spend the shared state budget, with the initial state counted once. Step capacity is checked before a call and state capacity before admitting a new successful state. A blocked, unsafe or out-of-bounds preferred step, or a sequence ending without a goal, falls back to the original start and time without resetting spent work. Preferred accounting never prunes the fresh regular frontier, and repeated execution still spends steps. Incomplete geometry and collision-budget exhaustion propagate immediately. Preferred failure alone never establishes `unreachable`.

### Immutable traversal worlds

The optional overloads accept `WorldTraversalContext<Id, World>`, `WorldTraversalState<Id, World>` and `WorldTraversalRequest<Id, World>`. The state carries an immutable `world`. `TraversalWorldAdapter` supplies `beginStep`, `endStep`, `key`, snapshot-specific `sampleColliders` and tri-state `safe`. The stateless overloads and preferred-command contracts apply unchanged.

`beginStep(world, request)` prepares the phase at the actual tick start before collider sampling; it must be pure and idempotent at that boundary. Geometry and safety use that snapshot for the entire tick. After successful physics, `endStep` receives the absolute tick-end time, full body and all resolved standing-support IDs in collider order. It records contact changes for the next boundary. A failed step returns the original body/world state with no committed segments. The runtime caller separately owns global phase advancement, which a failed actor transaction cannot roll back.

Lifecycle hooks return `TraversalAvailability<World>`. World safety returns `"safe"`, `"unsafe"` or `"unavailable"`; unknown geometry, occupancy or actor futures propagate `geometry-unavailable`. Adapters explicitly supply known other-actor future contacts and occupancy, replacing the planned actor's actual body with its hypothetical body. Unknown data must not become an empty contact set or safe geometry.

Both regular deduplication and shared preferred/regular charging include `world.key(world)`. Equal keys must imply identical future behaviour: include phases, deadlines, pending contacts, standing-contact memory, boundary preparation and any branch-varying external state. Use stable opaque identities without lossy object stringification. Preferred fallback restores the original body/world root while retaining spent work. Arrival validation prepares the world and rechecks actual standing support, clearance and safety. A found result carries that prepared arrival snapshot; witness replay must include final boundary preparation and terminal validation.

### Crumbling supports

`terrain/crumbling` exports `beginCrumblingStep(context, request, world)` and `endCrumblingStep(request, world)`. `CrumblingWorld` stores support phases (`intact`, `warning`, `absent`), deadlines, standing contacts, pending contacts and the last prepared boundary. Callers provide finite positive warning/absence durations, full collider volumes, actor/support identities and occupancy queries. No gameplay timing defaults are supplied.

At tick start, old deadlines take precedence. Warning expiry removes support for the entire tick; absence duration starts at that removal boundary. Eligible absent supports restore only when the full collider volume is clear of all physical bodies. Occupied supports retry at the next tick start; unknown occupancy returns unavailable. There are no sub-tick lifecycle events. Deadlines use active-world seconds and take effect at the first boundary at or after the deadline; a paused clock cannot advance phases.

The complete resolved contact set at tick end records newly standing actor/support pairs. At the next boundary, a new contact on an intact support latches one warning. Additional contacts and stepping off cannot cancel or extend it. Warning duration starts at this consuming boundary. Restoration alone cannot trigger warning; a subsequent new landing can. The adapter assembles complete other-actor contacts and supplies full-volume occupancy, including the substituted branch body, before using these pure transitions.

## Achievements

`achievements` judges a game's badge catalogue. An `AchievementDef` has an id, a tier and a non-empty list of conditions that must all hold; it carries no strings, so a game extends it with its own presentation fields. The game owns the condition union, the scopes and facts they are judged at, tiers, strings, art, tracking points and storage keys and versions.

- **Judging:** `judge(kinds)` takes one `ConditionKinds` registry, mapping each condition kind to its `scopes`, `holds` and optional `progress`. A condition never holds at a scope its kind does not list, and its evaluator is not called there; an unregistered kind throws `RangeError`. `progress(scope, facts, conditions)` returns the condition furthest from done, by minimum `have/need` fraction (the first on a tie, a need of 0 or less counting as done), with `have` clamped to between 0 and `need`; a kind reports progress at any scope. Conditions whose kind has no `progress` are left out, and it returns `undefined` when none has it. It is never full unless every condition holds at `scope`: a full result is then reported one short, as `{ have: need - 1, need }` for a need of 1 or more, `{ have: 0, need }` for a need between 0 and 1, and `{ have: 0, need: 1 }` for a need of 0 or less.
- **Ordering and awarding:** `orderByTier(tiers, defs)` is a stable sort by the given tier order, applied once to the catalogue, and throws `RangeError` for an unlisted tier. `newlyEarned(judge, catalogue, scope, facts, earned)` returns the ids not yet earned whose conditions all hold, in catalogue order. `award(ids, earned)` appends new ids in order and returns `earned` itself when nothing is new. `keepKnown(known, stored)` keeps the known ids of a stored array in order, without duplicates. `resolveThreshold(all, threshold)` resolves `"all"`.
- **Earned record:** `EarnedRecord` holds `earned` and `unannounced`, the earned ids not yet announced, both in award order. `earnedFormat(version, known)` is its `SaveFormat`, kept apart from the main save so a progress reset keeps it; loading prunes unknown ids, duplicates and unannounced ids that are not earned, and a record without both lists is corrupt. It has no migrations; add them by spreading the format. `earnedStore(storage, keys, format)` runs on `saveStore` and applies its calls one at a time in call order, so concurrent `award` and `announced` calls lose nothing. The first call of any kind reads storage first. `load()` resolves to that read's `StoreLoadResult` status and reason, with the current record as `save`. `award` appends the new ids to both lists and resolves to an `AwardResult`: the `added` ids and the write's `StoreSaveResult` as `save`, `undefined` when nothing was new and nothing was written. `announced` removes one id from `unannounced` and resolves to the write's `StoreSaveResult`, or `undefined`, with nothing written, when the id was not unannounced. Load and write failures follow `saveStore`: the record plays on in memory, and a blocked or failed write reports `unavailable` and an unencodable record `invalid`.
- **Notices:** `CelebrationQueue` keeps ids in push order, ignoring an id already waiting. `takeWhen(blocked)` returns `undefined` and keeps every id waiting while `blocked()` is true, and does not call it when nothing waits. Push the loaded record's `unannounced` ids at start, and call `announced` when a notice starts.

`achievements/preview` previews, during a run, the badges ending it now would earn, each once a run and without awarding anything. `previewAchievements(keyOf, earned, preview, subject)` calls `earned(subject)` only when `keyOf(subject)` differs from the last look's key, and returns the ids not yet shown with the next `AchievementPreview` (`key` and `shown`). Start each run from `NOTHING_PREVIEWED`. The key names every fact that can earn a previewed badge, and `earned` leaves out badges that must not be previewed.

## Numeric and text measurement contracts

`numbers.clamp(minimum, maximum, value)` evaluates `Math.min(maximum, Math.max(minimum, value))`. Bounds are not reordered: NaN propagates and reversed bounds return the maximum for non-NaN input. Preserve a caller's opposite nesting unless ordered bounds are established. `lerp(from, to, fraction)` evaluates `from + (to - from) * fraction` without clamping, sanitizing non-finite values or short-circuiting endpoints.

`text/bitmapFont.advanceWidth(font, scale, line)` measures pen advance, including trailing whitespace and kerning. Missing glyphs are skipped without replacing the previous known glyph. `inkWidth` measures visible columns and remains distinct.

## Standalone verification

```bash
npm run verify
```

`npm run verify` runs `node scripts/check.ts`, which CI also runs. The host needs Docker, Git and the Node version in `.nvmrc`, which runs the TypeScript tooling without a build step and names the container image. The gate starts only below one-minute load 24 and uses at most four CPUs and four Vitest workers. It installs dependencies offline from the npm cache and checks types, formatting, lint, tests and the compiled package in a container without network access. If the offline install fails, it populates the cache in a networked container and repeats the offline gate. Source fingerprints must not change during the run, and credential-shaped paths are refused before their contents are read.

Every container runs as uid and gid 19001, which owns nothing on the host, with the group of each mounted checkout added for reads, `HOME=/tmp`, a read-only root file system and only read-only host mounts. Scratch and outputs live in a per-run volume; results are copied out with `docker cp`, so files in the checkout keep their host owner. The gate masks ignored `.claude/` state and `.worktrees/` role worktrees; ESLint ignores both. When the gate fails, it keeps the packed artifact and its consumer probe in `.claude/artifact-check.*` and prints the path; a passing gate deletes them. The npm cache is the named Docker volume `game-kit-npm-cache`; `GAME_KIT_NPM_CACHE` names another. `node scripts/npm-cache.ts load|save <directory>` streams a host directory into the volume through a container, or copies the volume out with `docker cp`; CI uses it to carry the cache between runs, keyed on the `package-lock.json` hash.

| Container command            | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `npm run check`              | Check combined and per-environment types concurrently |
| `npm run lint`               | Check formatting, ESLint boundaries and Markdown      |
| `npm test -- --maxWorkers=4` | Run canonical unit and contract tests                 |
| `npm run format`             | Format a writable checkout                            |

WORKAROUND: Parent-scoped development overrides pin [KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) `0.18.2`, [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) `11.0.3` and [re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) `2.8.7`. ESLint loads cycle detection and its resolver through exported plugin subpaths because the full plugin imports an unused rule requiring minimatch's removed `makeRe` API. Keep cycle detection enabled. Remove each override when its parent supports the patched version; restore the full plugin import when it supports minimatch 11.

## Release artifacts and consumer proof

[GitHub releases](https://github.com/andornaut/game-kit/releases) distribute `game-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS`; there is no npm registry publication.

`node scripts/pack.ts <output-directory>` builds the committed revision in an offline container from the npm cache volume. It compiles JavaScript and declarations with `tsconfig.release.json` and packages the manifest, `SOURCE_COMMIT`, README and licence, without TypeScript source, tests, scripts or development commands.

```bash
GAME_KIT_ARCHIE_CACHE=<Archie-npm-cache> GAME_KIT_CHIBI_CACHE=<Chibi-npm-cache> \
node scripts/check-release-consumers.ts \
  <artifact.tgz> <sha256> <source-commit> \
  <Archie-repository> <Archie-revision> <Chibi-repository> <Chibi-revision>
```

The proof installs the exact artifact into immutable snapshots of both games' pinned revisions, offline. It checks the installed bytes, lockfile integrity, every export, native imports and declarations, each game's type check and Vite and Vitest configuration, and runs each game's `test:game-kit` npm script, which tests its kit wiring; a snapshot without that script fails. It never edits a checkout or builds or deploys a game. `GAME_KIT_ARCHIE_CACHE` and `GAME_KIT_CHIBI_CACHE` are required and name each game's populated offline npm cache, mounted read-only. Logs, archive listings and results are kept in the printed evidence directory.

Tag a release only after every required workflow is green for that `main` commit and the artifact passes the consumer proof. Tags and release assets are never moved.

## Licence

[MIT](LICENSE) covers helper code. Consuming games retain their own art, font and content licences.
