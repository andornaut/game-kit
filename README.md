# game-kit

Game-independent TypeScript mechanisms and Phaser adapters. Games supply content, strings, palettes, dimensions, schemas, tuning and lifecycle policy. Parent projects own their websites, PWA integration and asset/build tooling.

## Importing

Import individual public modules without an extension:

```ts
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/random";
import { memoryStorage, type SaveStorage } from "@andornaut/game-kit/save/storage";
```

The compiled GitHub release archive contains JavaScript and declarations. Install its versioned URL and commit the consumer lockfile with URL and integrity. No npm registry publication or source aliases are required. `SOURCE_COMMIT`, inside the archive and alongside it, records the exact source revision. Tests and standalone scripts are private. Pure imports need no runtime peers; Phaser adapters require the consuming game's `phaser` dependency.

## Version and interface policy

The source package is version `0.7.1`. The explicit `exports` map and exported declarations define the public interface. Internal imports are relative and acyclic; there is no root barrel loading an engine for pure callers.

Compatible fixes use patch versions; additive public facilities use minor versions. After 1.0, incompatible changes require a major version. Before 1.0, incompatible changes require a minor version and an explicit migration. Update the manifest and root lockfile together. Prove the compiled artifact against exact consumer revisions before publication. Documentation-only changes need no version bump.

## Migration to 0.8.0

- `text/phaser/registerPixelFont` throws an `Error` naming the key when the texture key is invalid or already in use without a cached font, instead of returning without registering. Use a key no other texture uses.

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
| `clock/phaser/*`, `input/phaser/*`, `progress/phaser/*`, `text/phaser/*`, `view/phaser/*`                         | Phaser, browser renderer | Frame caps, input guards, progress drawing, fonts, snapshots and modal backdrops |

Only `phaser/` directories import Phaser. Pure environment compilation rejects browser and Node ambient globals. Renderer compilation rejects Node globals. The combined test/config project has the development types it needs.

## Integration contracts

- **Input:** callers supply event coordinates, timestamps, equality, hold thresholds, drag/fling tuning and reduced-motion policy. Clients perform returned actions and apply modal gates to their input routes.
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks and randomness. `motion/Point` is a compatibility export of `rect/Point`.
- **Pixel fonts:** `PixelFontContext` supplies glyph bits, widths, height, spacing and space width. The kit returns geometry and advances; clients own glyph definitions and normalization. Phaser registration takes explicit font options and throws an `Error` naming the key when that texture key is invalid or already in use without a cached font.
- **Progress:** `undefined` means an unknown total, drawn as a static centred segment; finite progress is clamped to zero through one. `createProgressState` replaces the previous operation on `begin`; stale handles cannot update or finish its replacement. Clients own visibility, labels and timing and clear Phaser graphics.
- **Rendering:** `mountModalBackdrop(context, area)` owns its unique texture and display object and exposes `ready` and `destroy()`. It falls back when snapshot capture rejects. `snapshotRemapped` reads the area at the WebGL renderer's post-render point with Phaser's snapshot geometry, row order and un-premultiplication, or through `snapshotArea` on the Canvas renderer, and writes the remapped pixels into a canvas texture. The client owns modal layout, input and pausing.
- **Saves:** games own keys, schemas, validation and migration policy. Newer stored versions are preserved; corrupt saves are backed up before replacement. Failed reads or backups disable writes for the session. Failed writes may be retried. Encoding and JSON serialization failures return `invalid` without writing. `SaveStorage` is the parent adapter's port; `memoryStorage` is its pure in-memory implementation.

## High-density game UI

`view/phaser/uiProjection` maps the actual canvas CSS size and explicit device pixel ratio to an integer backing size. `view/phaser/uiSubmitter.createUiRecorder` atomically registers sibling roots through public Phaser render roles, retaining game-owned input, hierarchy and clocks. Registration waits for the caller's exact font readiness promise and rejects unsupported groups without partial routing. Refresh and disposal restore only still-owned roles.

`view/phaser/uiCommands.presentUi` replays ordered text, raster quads and uniform triangles with camera viewport clips. `text/phaser/uiGlyphPen` derives source-font pen and baseline transforms from public glyph data and submitted quads, preserving signed bearings without measuring or reflowing text. Callers supply font faces, source metrics, image sources, surfaces and lifecycle policy.

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

| Container command            | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| `npm run check`              | Check combined, pure and Phaser types concurrently |
| `npm run lint`               | Check formatting, ESLint boundaries and Markdown   |
| `npm test -- --maxWorkers=4` | Run canonical unit and contract tests              |
| `npm run format`             | Format a writable checkout                         |

TypeScript, Vite and Vitest are development tools, not runtime peers. `@types/node` supplies private tooling/test types. Phaser is the only optional runtime peer and is required when importing its adapters. Tests belong to the canonical library suite; consumers test their own integration.

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
