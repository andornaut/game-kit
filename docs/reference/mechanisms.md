# Game mechanisms

Use the pure runtime modules with game-owned rules, data and tuning.

[Reference](README.md)

## Terrain

### Traversal

`terrain/traversal` exports `stepTraversal(context, input, state)` and `findTraversal(context, request)`. Runtime and search run the same fixed-step finite-AABB kernel, so a `found` witness replays.

- **Kernel.** The kernel applies immediate horizontal intent, fixed-step gravity, jumps and falls, swept solid side and ceiling clipping, and moving-solid push and carry. Ledges block only downward relative crossings, without snapping from below. Safe grounding needs full-foot support and body clearance, and the goal is a landing corridor containing the complete body.
- **Caller supplies.** Resolved pixels/second, absolute seconds, body size and offset, profile, timestep, bounds, drop limit, `maxCollisionSteps` and swept-body hazard predicates. `sampleColliders(timeSeconds, dtSeconds, queryBounds)` returns complete swept-entrant coverage with stable opaque ids, solid or ledge kinds and before/after rectangles. Ordinary mover endpoints describe the exact discrete tick path, even for nonlinear easing. Graph movers supply contiguous absolute-time segments. Unknown reactive futures return `complete: false`. Callers keep self-exclusion, snapshot ordering, caches and pursuit policy.
- **Budget and results.** `TraversalBudget` supplies finite `horizonSteps`, `maxStates` and `maxSteps`. Results are `found` (timestamped inputs), `unreachable` within the exhaustively searched domain, `budget-exhausted` (`states`, `steps` or `collision`) and `geometry-unavailable`. A failed step returns the original state with no committed segments. Mixed-motion support unions do not establish safe grounding, and pushes beyond sampled geometry return `geometry-unavailable`. Revalidate every executed step against current geometry.
- **Preferred inputs.** `TraversalRequest.preferredInputs` is one optional sequence of `TraversalCommand` values, tried before the regular search and validated whole first (at most `horizonSteps` long, move -1, 0 or 1, boolean jump, any `timeSeconds` property, own or inherited, rejected with `RangeError`). Clocks come from the request time and timestep, and an empty sequence changes nothing. Its kernel calls, including failed ones, and its states spend the shared budgets. A blocked, unsafe or out-of-bounds step, or a sequence ending without the goal, falls back to the original start without refunding work and never establishes `unreachable`. Incomplete geometry and collision-budget exhaustion return at once.

Frontier ordering is deterministic. Its priority and tie-breaks are commented in the search core of `src/terrain/traversal.ts`.

### Immutable traversal worlds

Overloads taking `WorldTraversalContext`, `WorldTraversalState` and `WorldTraversalRequest` carry an immutable `world` through a `TraversalWorldAdapter`.

| Member            | Contract                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beginStep`       | Prepares the phase at the actual tick start, before collider sampling, pure and idempotent at that boundary. Geometry and safety use that snapshot.                                                                                  |
| `endStep`         | Receives the tick-end time, full body and all resolved standing-support ids in collider order, and records contact changes for the next boundary.                                                                                    |
| `sampleColliders` | Snapshot-specific geometry.                                                                                                                                                                                                          |
| `safe`            | Returns `"safe"`, `"unsafe"` or `"unavailable"`.                                                                                                                                                                                     |
| `key`             | Equal keys imply identical future behaviour. Include phases, deadlines, pending and standing contacts and any branch-varying state, as stable opaque ids rather than lossy object strings. Deduplication and budget charging use it. |

Hooks return `TraversalAvailability<World>`. Unknown geometry, occupancy or actor futures yield `geometry-unavailable`, never an empty contact set or safe geometry. Adapters supply known other-actor contacts and occupancy, substituting the planned actor's hypothetical body. A failed step returns the original body and world. Global phase advancement belongs to the runtime caller and is not rolled back. Arrival validation prepares the world and rechecks standing support, clearance and safety. A found result carries that prepared snapshot, so witness replay includes final boundary preparation and terminal validation.

### Crumbling supports

`terrain/crumbling` exports `beginCrumblingStep(context, request, world)` and `endCrumblingStep(request, world)`, pure transitions for a traversal world adapter. Callers provide finite positive warning and absence durations, full collider volumes, actor and support ids and occupancy queries. There are no gameplay defaults.

- Phases are `intact`, `warning` and `absent`, and change only at tick starts, in active-world seconds, at the first boundary at or after a deadline. A paused clock cannot advance them.
- Old deadlines take precedence. Warning expiry removes support for the whole tick, and absence starts at that boundary.
- An absent support restores only when its full volume is clear of all bodies. Occupied supports retry next tick. Unknown occupancy returns unavailable.
- A new standing contact on an intact support latches one warning at the next boundary, and its duration starts there. More contacts or stepping off cannot cancel or extend it, and restoration alone cannot trigger one.
- The adapter assembles complete other-actor contacts and full-volume occupancy, including the substituted branch body, before calling these transitions.

### Movement and air maps

| Module                | Builds                                                                                                                                                                                       | Queries                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `terrain/movementMap` | `buildMovementMap(options, profile, area)` builds ground spans and `walk`, `jump`, `drop`, `wall-top`, `climb` and `track-climb` edges witnessed by the kernel. Dijkstra queries use seconds | `locate`, `pathTo`, `nearestReachable`, `pathOrNearest`, `reachableSet`, `sinks`, `mapCanonical`, `mapHash` |
| `terrain/airMap`      | `buildAirMap(options, profile, area)` builds a flyer cell grid with `fly` edges and perch `land`/`lift` edges. A\* queries include an axis-change penalty                                    | `locateAir`, `airPath`, `nearestReachableAir`, `reachableAir`, `sinksAir`, `airMapCanonical`, `airMapHash`  |

Node and edge construction, window clipping and the canonical line format are documented on `buildMovementMap`, `mapCanonical`, `buildAirMap` and `airMapCanonical`. Both maps follow the same caller contracts.

- Built geometry is static. Movers, crumbling supports and timed hazards stay with the caller, which names them through `deps` and disables them per query through the mask. Invalid input throws `RangeError`.
- An optional `window` builds only the part of the map inside it. Ids belong to one map, so carry positions between maps as hitboxes through `locate` or `locateAir`. In an air map window, a path costs the same as the full map's when the full map's least-cost path lies inside it. Rebuild around the subject when it or its goal nears the window's edge.
- Area callbacks (`blocked`, `deps` and the movement map's `kind`) must be pure. Builds call them in no promised order and skip states they can prove produce no edge.
- Queries are pure and cache nothing. Cache per (from, goal, mask key). Ties go to the lower node id.
- Movement map queries settle each edge once, at its earliest arrival the mask accepts, in order of seconds, then node id, then edge id. Equal seconds over one edge go to the arrival generated first, which is the one whose predecessor settled first. Masks must be pure within a query. Each node verdict is asked once, and an edge's only for an arrival earlier than every arrival it already accepted for that edge.
- Movement queries accept `MapQueryContext extends MapMask` at the existing mask argument. Its optional `onWork` receives one `MapQueryWork` on normal completion, including a masked start, no path or a fallback. `nodesReached` sums first arrivals per node, `arrivalsSettled` counts processed nonstale arrivals including the start, and `heapPushes`/`heapPops` count actual heap operations including stale entries. `sinks` sums its internal searches. `pathOrNearest` uses one search. Without an observer there is no diagnostics object or counter updates. Validation, mask and predicate errors produce no callback. Observer errors propagate.
- Hashes are FNV-1a 64 of the canonical form. Build and queries use no `Math.random`, `Date` or `performance`.

## Achievements

`achievements` judges a game's badge catalogue, orders and awards badges, keeps the earned record in its own versioned save (so a progress reset keeps it) and queues unlock notices. The game owns the condition union, scopes, facts, tiers, strings, art, tracking points and storage keys and versions. `achievements/preview` previews the badges ending the run now would earn, each at most once a run and without awarding. Push the loaded record's `unannounced` ids into `CelebrationQueue` at start, and call `announced` when a notice starts. Progress rules, ordering and store semantics are documented in `src/achievements.ts` and `src/achievements/preview.ts`.

## Utility scoring

`ai/utility` scores candidate actions as `gate × base × Π curveValue × multiplier` and chooses one with hysteresis and a single seeded draw among near-equal scores, so replays from the same seed and inputs choose the same actions. Games own the inputs, actions, values and behaviour. Curves, hold rules and result reasons are documented in `src/ai/utility.ts`.

## Numbers and text measurement

- `numbers.clamp(minimum, maximum, value)` does not reorder bounds and propagates NaN. `lerp` does not clamp. See `src/numbers.ts`.
- `text/bitmapFont.advanceWidth` measures pen advance, including trailing whitespace. `inkWidth` measures inked columns. See `src/text/bitmapFont.ts`.
- `runtime/lines.splitBalancedGraphemes(measure, text)` returns two nonempty strings at a Unicode grapheme boundary, preserving the exact input. It measures every complete prefix/suffix pair and minimizes maximum width, then width difference, then boundary position. Empty or single-grapheme input returns `undefined` without measuring. Measurements must be finite and nonnegative or it throws `RangeError`. Callback errors propagate. The caller can apply it to overwide words after `wrapWords`. It supplies no width limit or font policy and requires `Intl.Segmenter`.
