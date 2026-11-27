# game-kit

Game-independent TypeScript mechanisms, Phaser adapters and website infrastructure. Games supply content, strings, palettes, dimensions, schemas, tuning, policies and lifecycle. Parent projects own their asset tooling and wire `runtime/web/*` modules into their own pages and `build/*` modules into their Vite configuration.

## Importing

Import individual public modules without an extension:

```ts
import { frameSteps } from "@andornaut/game-kit/runtime/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/runtime/random";
import { memoryStorage, type SaveStorage } from "@andornaut/game-kit/runtime/save/storage";
```

Install the compiled release archive by its versioned URL, `https://github.com/andornaut/game-kit/releases/download/v<version>/game-kit-<version>.tgz`, and commit the lockfile with its URL and integrity. The archive holds JavaScript and declarations; `SOURCE_COMMIT`, inside it and alongside it, records the source revision. Tests and scripts are private.

Pure imports need no runtime peers. Phaser, TypeScript, Vite and Vitest are optional peers: `phaser/` adapters need the game's `phaser`, Vite plugins its `vite`, `build/phaserUses` its `typescript` and `build/gameConfig` its `vitest`. Every `phaser/` adapter may import Phaser at runtime, so a game test that mocks it with `vi.mock("phaser")` must inline the kit with `test.server.deps.inline: ["@andornaut/game-kit"]`.

## API namespaces and migration

Version 0.47.0 introduced canonical imports using `@andornaut/game-kit/runtime/...`, `@andornaut/game-kit/build/...` or `@andornaut/game-kit/test/...`. The remaining pre-0.47 aliases have been retired. Every public subpath is explicit in `package.json`. The `@andornaut/game-kit/package.json` metadata export remains available.

| Namespace  | Use                                                                                                             | Dependency direction                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `runtime/` | Game and website runtime, including pure mechanisms, browser and Phaser adapters, CSS and shared data contracts | Must not import build tooling or test helpers                  |
| `build/`   | Build configuration, asset processing, generated metadata and plugins                                           | May import runtime modules; must not import test helpers       |
| `test/`    | The three shared testing APIs                                                                                   | For tests only; runtime and build modules must not import them |

For the retired aliases, use `runtime/<legacy-path>` except for the build and test mappings below and `web/build/buildLabel`, whose canonical path is `runtime/web/buildLabel`. The source layout and environmental constraints remain separate from these consumer namespaces.

| Canonical build path          | Retired compatibility path               |
| ----------------------------- | ---------------------------------------- |
| `build/rgbaImage`             | `art/rgbaImage`                          |
| `build/buildVersion`          | `web/build/buildVersion`                 |
| `build/phaserBuild`           | `web/build/phaserBuild`                  |
| `build/buildInfo`             | `web/build/vite/buildInfo`               |
| `build/contentHash`           | `web/build/vite/contentHash`             |
| `build/gameConfig`            | `web/build/vite/gameConfig`              |
| `build/gitHead`               | `web/build/vite/gitHead`                 |
| `build/phaserBuildPlugin`     | `web/build/vite/phaserBuildPlugin`       |
| `build/phaserSource`          | `web/build/vite/phaserSource`            |
| `build/phaserUses`            | `web/build/vite/phaserUses`              |
| `build/securityHeaders`       | `web/headers/securityHeaders`            |
| `build/securityHeadersPlugin` | `web/headers/vite/securityHeadersPlugin` |
| `build/hashedIcons`           | `web/pwa/hashedIcons`                    |
| `build/precacheList`          | `web/pwa/precacheList`                   |
| `build/hashedIconsPlugin`     | `web/pwa/vite/hashedIconsPlugin`         |
| `build/precachePlugin`        | `web/pwa/vite/precachePlugin`            |

The test paths replace only the `testing/` prefix: `test/storageFixture`, `test/dom/failingLocalStorage` and `test/phaser/sceneStub` map to their existing implementations.

Move image processing from `art/rgbaImage` to `build/rgbaImage`, which also exports the `RgbaImage` type. Runtime code that only needs the type should import it from `runtime/art/rgbaImage`. Build manifest construction and validation use `build/buildManifest`. The build identity and installed-build contracts use `runtime/web/pwa/buildIdentity` and `runtime/web/pwa/buildContract`.

Apply the mapping to JavaScript and TypeScript imports, test mocks and configuration, and stylesheet imports. Change the old build-info reference to `/// <reference types="@andornaut/game-kit/build/buildInfo" />`. This declaration-only export still provides `__APP_VERSION__`, `__BUILD_ID__` and `__COMMIT__`. Historical migration notes use the subpaths current at the time. The source inventory uses implementation paths relative to `src/`.

## Foreground input

Use `bindForegroundInput(options, document)` from `runtime/web/input/dom/foregroundInput` to
give the active page, modal, recovery panel or crash screen one input owner. Bind it before
game-level capture handlers. Register each page with its current action resolver and remove
its registration on exit. Pass the router to `createModalLayer(root, foregroundInput)` and to
loading failure and crash options. Replace overlapping legacy key and secondary-button handlers
when adopting the router.

Arrows, WASD and HJKL move focus. Enter, Space, E and F invoke the focused eligible action.
Editors, composition, native controls and keys explicitly reserved by the surface keep their own
handling. Supply `preserveKey` where a control owns directional movement. Escape uses the top
surface's eligible Skip or dismissal. The game supplies the fallback and eligibility rules.

Secondary pointer activation resolves the current action on guarded release. Drag, cancellation,
surface changes and loss of availability prevent activation. Context-menu suppression is scoped
to the gesture. With the router omitted, existing modal and recovery bindings retain their defaults.

## Placed row heights and one-action centring in 0.91.0

- Additive. A placed form row list takes a height per row: `rows.place(context, [{ element, height }])` and `FormRowsRow.height` in `formRowsGeometry`, in whole units. A row without one is a slider's `layout.height` or the layout's `height`. Each row's track, padding, icon, switch, lane, art-locked sizes and press dip follow its own height, so rows of different heights share one list instead of one list per height. Lists without per-row heights render as in 0.90.0.
- Changed. A one-action row's face is centred in the whole row, the list's padding included, with the odd unit right and below; it was centred inside the padding. A one-action row in a list with unequal left and right, or top and bottom, padding moves its face, and the face must fit the row rather than its content. In CSS the row takes no padding, and on a placed list `--ui-form-action-top` is from the row's top. A game that gave its one-action row an unpadded list of its own can place it in the shared list. Rows without an action are unchanged.

## Update progress

An installed launch starts a bounded deployment-pointer read before reclamation and boot.
Ordinary discovery can reuse the result after reclamation, and Start does not wait for the read.

Opt in with `LaunchOptions.onUpdateProgress` from `runtime/web/pwa/dom/launch`. Use the emitted
`UpdateProgress` phases to drive the existing loading bar.

| Phases                    | Presentation                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `preparing`, `verifying`  | Indeterminate staging                                                                                     |
| `transferring`            | Measured `receivedBytes / totalBytes`. A fully cached stage can skip transfer.                            |
| `idle`, `ready`, `failed` | End staging. The offer comes from `onUpdateReady`.                                                        |
| `applying`                | Indeterminate Apply. The `step` reports save, verification, activation or reload.                         |
| `booting`                 | Continue the matching version's Apply in the new document. Use `counts.done / counts.total` when present. |
| `applied`, `applyFailed`  | End Apply. Continue handling any rejected `updateNow` promise.                                            |

Keep one presenter per document. Use these events instead of separate legacy staging or Apply
activity when opted in. Keep `onProgress` for first install and ordinary boot. Session storage
carries the version across a successful Apply. If the record cannot be used, boot reports
normally. Automatic and save-required activation use their existing reporting.

## Migration to 0.92.0

The precache plugin now rejects `fetch-json-data-v1` with grouped or whole-build archive
updates. Use per-file updates to keep that profile. For archive updates, use the URL-array
form only for JSON families that meet its URL-independent response contract.

## Migration to 0.78.0

Breaking. `runtime/web/pwa/dom/launch` no longer exports the deprecated
`browserLaunchContext`. Call `prepareBrowserLaunch({ parent, onUnsupported }, policy)`
and pass a `supported` result's `context` to `createLaunch`, as in
[Grouped updates](#grouped-updates). An `unsupported` result has already shown
the shared error, so the game does not start. `createLaunch`, its options and
its behaviour are unchanged.

## Decoded group copies and DecompressionStream in 0.74.0

`precachePlugin({ omitDecodedGroupCopies: true })` stops emitting the decoded
`/.game-kit/archive-<sha256>-0.bin` copy of each compressed group. The
pointer, manifest and `group-` files are unchanged. Set it once no installed
device of the game still runs GameKit 0.72.0 or earlier, since those pages
stage groups only from the decoded copies. Without the option the copies are
still emitted. The option requires `updateGroup` and rejects
`emitUpdateGroupRecipes`, whose groups have no compressed transport. A later
minor release, once every grouped game sets it, removes the copies and the
option.

`prepareBrowserLaunch` now also requires `DecompressionStream`. Without it the
page shows the shared unsupported error with no Retry instead of failing a
grouped first install with Loading failed. The check applies to every
production launch, because the pointer that marks a build as grouped is read
only after startup, and every browser in Vite's default build target
(Chrome 111, Firefox 114, Safari 16.4) provides it.

## Compressed group archives in 0.73.0

`updateGroup` builds without `emitUpdateGroupRecipes` emit each group as one
deterministic gzip member at `/.game-kit/group-<sha256>.bin` (`buildGroupUrl`
from `runtime/web/pwa/buildContract`). Each pointer group gains
`encoding: "gzip"` and `encodedByteSize`. Its `byteSize` and `sha256` still
describe the decoded archive, so unchanged groups keep their digests, the
build version does not depend on the transport, and devices reuse the groups
an earlier kit stored. Deploy the
new files with the rest of the output and serve them as
`application/octet-stream` without HTTP coding. An origin that reads archives
for `createGroupArchiveMemberReader` must store the `group-` files, whose
paths the reader now requests.

The build still emits each decoded archive at its
`/.game-kit/archive-<sha256>-0.bin` path, because pages on GameKit 0.72.0 or
earlier stage grouped updates only from those files. A device on such a build
downloads the decoded archives once, then uses the compressed transport from
its next update. `omitDecodedGroupCopies` stops emitting these copies.

`validateBuildPointer` from `build/buildManifest` now accepts every pointer
the build emits: whole-build archives, groups with sound formats and
transports, and grouped first installs. Earlier releases rejected any pointer
with `archive`, `groups` or `groupedFirstInstall`.

## Codec-aware groups in 0.72.0

`updateGroup` builds now split each group's sound alternatives into one group
per format, so group digests and counts change once and a build near the
100-group cap can exceed it. Grouped installs and updates skip groups of other
sound formats and verify against the device's reduced manifest. See
[grouped updates](#grouped-updates) and
[serving group archive members](#serving-group-archive-members-at-the-origin).

## Migration to 0.65.0

- `createButton(document, options)` passes the actual button element to
  `getState(element)` and `getAction(element)`. Zero-argument providers still
  work. Forward the element when wrapping either hook. Initial state reads may
  occur before the element is attached to the DOM.
- Pass `createDomProgressBar({ style, frame, timing }, parent)`. The timing
  field is optional and the returned handle is unchanged.
- Pass `guardBackNavigation({ onBack, stateKey, timer, createCloseWatcher, history }, eventTarget)`.
  `BackGuardContext` replaces `BackGuardOptions`. Pass the same timer and history.
  Pass `createCloseWatcher: undefined` when no watcher factory is available.
- Pass `followFrameTurn({ watch, gameSize, parent, deviceResolution }, game)`.
  Keep the live `gameSize` reference and the existing disposer. The device
  resolution field is optional.
- Pass `installCrashScreen(options, page)`. Register it at the same early
  startup point.

A timer-held touch that dismisses a dialog now protects restored focus from
the matching touch-derived mousedown on the exposed view.

## Installed-window update discovery in 0.64.1

Window focus now requests an ordinary update check even when the installed
document stays visible. The existing 60-second cooldown and explicit
Update now flow apply. Games only need to update the package pin.

## Migration to 0.64.0

The deprecated pre-0.47 package subpaths are gone. Use the canonical paths
above, including in mocks, CSS and generated references.

`runtime/web/pwa/dom/launch` no longer exports `LAUNCH_RELOAD_KEY`,
`LAUNCH_PROGRESS_KEY`, `legacyRoutingCacheName` or `legacyGroupDatabaseName`.
Use the launch lifecycle and `bootProgress()` for recovery. Version 0.69 removes
the pre-router cache migration.

## Optional install packs in 0.63.0

Set `packs: { maxBytes }` on `precachePlugin` to batch eligible small assets
into gzip envelopes with a decoded byte limit. Each verified member keeps its
original URL. Sparse updates, unavailable packs and unavailable decoding use
individual files. See the [install and update design](docs/install-and-update.md)
for HTTP representation and transfer qualification.

## Optional whole-build updates

Set `wholeBuild: true` in `precachePlugin` to download a complete archive when
the build version changes. Use it for games where copying thousands of cached
files costs more than downloading the build again. Omit the option for
ordinary delta staging.

The pointer identifies one archive by size and SHA-256. Parts are capped at
24 MiB to fit static hosting limits. The updater verifies the complete archive
once and stores it intact. The worker serves each pinned build by logical URL
from the archive index. A version match skips the archive download.

First install uses the existing bootstrap and can still use `packs`.
Archive updates fetch the archive parts only. The manifest and current files
are available for first install. Whole-build staging waits for a controlling
worker that supports the archive
format. Existing in-session consent, cold-launch activation and required-save
recovery apply to complete archives.

## Grouped updates

`precachePlugin({ updateGroup, ...options })` assigns each discovered file to
one group. `updateGroup(url)` returns a stable group name for the canonical
request URL. Keep frequently changed files separate from stable assets. Each
group has its own SHA-256 and is capped at 24 MiB, including its index.

Each group is served as deterministic gzip at `buildGroupUrl(group)`, so wire
bytes stay near the gzip size of its members without host compression. Serve
these files as emitted, like install packs. The page checks the exact
transport length, decodes it within the archive size and verifies the
archive's SHA-256 before storing the decoded archive. Progress counts
transport bytes. Compressed groups need `DecompressionStream`, which
`prepareBrowserLaunch` requires.

An unchanged version skips staging. For a changed version, the page reuses
verified groups from earlier builds and downloads missing groups one at a time.
The router serves the pinned version's files from the groups. A complete build
still has one activation, and interrupted staging preserves the active build.
First install can use the current build’s ordinary files or install packs.
Grouped staging requires a controller that supports group archives.

At production startup, call `prepareBrowserLaunch({ parent, onUnsupported }, policy)`
from `runtime/web/pwa/dom/launch` before creating the installer or game. It
requires Service Worker, Cache Storage and `DecompressionStream`. With a
`supported` result, pass its context to `createLaunch`. With an `unsupported`
result, the shared error is already visible and game startup stops. The callback
stops the caller's existing loading progress before the error is shown. The
returned `failure` view owns its teardown. Supply `failure.presentation` or
`failure.layout` to fit the existing game frame. The capability error has no
Retry action. Recoverable failures still use the installer's Retry.

Set `groupedFirstInstall: { archiveOnly }` with `updateGroup` to use the same
prebuilt group archives for first install and updates. The game supplies an
`archiveOnly(url)` predicate for emitted members that only need to be served
inside the installed game. These members stay in the build manifest and group
archives. Keep bootstrap resources and anything the site serves directly out
of the predicate. Keep selected members out of any separate public asset copy
step as well. This option uses static archives and is incompatible with install
packs, update group recipes, and whole-build archives.

Sound alternatives form their own group per format under the name
`updateGroup` returns, and the pointer tags each such group with its
`soundFormat`. A grouped first install or update downloads only the groups
without a format and those in `createLaunch`'s `soundFormat` (`buildRecords`'
`installedPointer`), and verifies the stored groups against
`installedManifest(soundFormat)` before activation or staging, so the device
downloads no other format's sound bytes. An `undefined` sound format installs
every group. Grouped staging reads the build manifest for this check. Groups
an earlier kit built without format tags still install in full.

Install and staging can reseal a build for a different sound format, reusing
shared groups by digest. For an already active grouped build, online startup
can also recover the new format's audio when the exact active version is
still deployed and the controlling worker supports group repair. Launch
verifies the selected groups and rechecks the active and staged records before
sealing them. The router keeps its pinned snapshot and can serve newly
recovered audio missing from that snapshot for the same version. If recovery
is unavailable or fails, play continues without the missing sounds. The old
groups stay stored until the build is reclaimed.

The build rejects more than 100 groups in grouped mode, counting each sound
format's group separately, or more than 100 listed files in specific-file
mode. This counts update units. First-install packs, and other website output
have their own layout. The `wholeBuild: true` transport is separate from
`updateGroup`.

## Serving group archive members at the origin

The router serves archived members at their original URLs from the client's
pinned build or the active build. A navigation whose URL is absent from the
selected build goes to the network without a new pin. Subsequent requests
from that page can still use the active build for listed assets. An origin
can serve `groupedFirstInstall` archive-only members from the emitted group
archives for pages without a usable installed build.
Pass the deployed `build.json` and an archive body storage callback to
`createGroupArchiveMemberReader({ readArchive }, pointer)` from
`runtime/web/pwa/dom/groupArchiveMemberReader`. The callback receives each
group's emitted path, `buildGroupUrl(group)`, and returns the stored body,
which for a compressed group is its gzip transport. Resolve the request
pathname with `reader.read(path)`. The reader locates members from the
decoded archive indexes, then serves a member only after checking the
transport size and the whole archive's size and SHA-256 from the pointer. It retains one verified archive per
instance. An unknown path returns `undefined` so the host can try ordinary
assets. A known path with a missing or invalid archive rejects. The host owns
HTTP method and cache policy.

To test such a reader against real archives, build groups with
`encodeGroupArchive({ soundFormat }, members)` from `build/groupArchive`. It
takes `{ url, bytes }` members and returns the pointer entry `group`, the
transport `path` and `encoded` bytes, the decoded `archive` and its index
`files`, byte-identical to the `precachePlugin` output for the same members.
Omit `soundFormat` for a group without one.

```ts
const { encoded, group, path } = encodeGroupArchive({}, [
  { bytes: new TextEncoder().encode("{}"), url: "/data/level.json" },
]);
const pointer = { ...deployedPointer, groups: [group] };
const reader = createGroupArchiveMemberReader(
  { readArchive: async (p) => (p === path ? new Blob([encoded]).stream() : undefined) },
  pointer,
);
```

## Packed origin files

Use `build/originMemberPacks` to collect selected original paths in
content-addressed gzip archives. Explicit aliases must use the same bytes and
media type. The returned schema-1 index at `runtime/web/pwa/originMemberIndex`
records archive and member SHA-256, byte sizes, member offsets and media types.
Emit the returned archives at their supplied paths. Both encoded and decoded
archive sizes are bounded at 24 MiB.

At the origin, pass the index and an archive body storage callback to
`createOriginMemberReader` from `runtime/web/pwa/dom/originMemberReader`.
Resolve the request pathname with `reader.read(path)`. An unknown path returns
`undefined` so the host can try ordinary current-build assets. A known path
with a missing or invalid archive rejects. The host owns HTTP method and
cache policy and controls how failures are served.

Origin packing works for direct HTTP requests without a service worker. It
preserves the logical URL inventory and leaves update mode and update counts
unchanged.

## Reconstructing update archives at the origin

Set `emitUpdateGroupRecipes: true` alongside `updateGroup` in
`build/precachePlugin`. Starting in 0.69.0, this emits one JSON recipe at
`updateGroupRecipesPath(version)` from `runtime/web/pwa/buildContract` and
omits the raw archive files. The pointer, manifest and requested archive
URLs stay the same, and recipe groups keep the decoded archive as their
transport because the origin assembles it. Omit the flag to serve the emitted
archives directly.

For a version whose backing files are selected, pass its recipe to
`createUpdateGroupArchiveReader({ readMember }, recipe)` from
`runtime/web/pwa/dom/updateGroupArchiveReader`. The callback reads an exact
body stream from that version’s immutable storage or verified origin member
reader. Use that storage directly to avoid routing back into the assembler.
`reader.read(path)` reconstructs a known archive at its existing URL after
checking member and archive bytes. Unknown paths return `undefined`. Known
paths with missing or invalid bytes reject.

Qualify the assembled route against the current build before deployment.
The host owns method handling and HTTP cache policy. Publish only the
current build’s required backing files and one representation of each
archive. Local caches still preserve the active build during staging.

## Refusal admission and Retry press cues in 0.62.1

Pointer refusal runs only when the caller resolves a current action. Configured loading-safe Retry shows a non-ring press cue for fixed or content width, including forced colours.

## Obsolete update offers and local checks in 0.62.0

- A superseded update rejects with `ObsoleteUpdateOfferError` from `runtime/web/pwa/buildContract`. Close only the matching displayed prompt. The error names the version that started the switch. Genuine failures keep the existing error path.
- Local working-tree and release checks share one runner. `make check` requires host Node 24.21.0 or newer. Tests and packaging still run in Docker.

## Update discovery and control options in 0.61.0

- `createLaunch(...).requestUpdateCheck()` asks the existing ordinary discovery scheduler to check after the game's genuine return to Start. Explicit Update now still applies the offered build.
- Standard buttons accept guarded pointer refusal without a keyboard tab stop or an announced reason.
- The configured loading-safe Retry can fit its label with `action.widthPx: "content"`, retaining the caller's padding and height.

## Update activation and startup recovery in 0.60.1

Update now revalidates the offered build after saving. If the offer was superseded, the returned promise rejects and the current active and staged builds are preserved. A failed startup storage read now reaches the existing Loading failed callback, whose Retry repeats the read before deciding whether to install. See the [install and update design](docs/install-and-update.md).

- Return `{ kind: "pointer-refusal" }` as the availability from `getState` to leave a non-executable button visible and skip keyboard navigation. Supply `onPointerRefusal` for guarded pointer feedback. The renderer does not announce a reason or run the action in that state.

## Button state styling in 0.60.2

Standard controls, loading-safe Retry, crash buttons and the crash details summary use face, text or icon changes on keyboard focus, including in forced colours. Persistent borders, hit targets and native activation stay in place. An engine without the required CSS support can use its native focus indicator.

## Required loading status checks in 0.59.1

Fix. In `createRequiredLoading`, a provider `status()` that throws while `retry()` starts no longer escapes `retry()` synchronously or leaves the attempt in flight. That `retry()` returns a promise rejected with the thrown error, the provider is not retried, and the next `retry()` starts a fresh attempt. No game change is needed beyond the version.

## Migration to 0.59.0

Breaking. The page installs and updates the game under one loader, and the service worker only routes. Each game changes:

- `runtime/web/pwa/dom/launch` replaces `startOfflinePlay` (`web/pwa/dom/offlinePlay`) and `UpdateFlow` (`web/pwa/dom/updateReady`), including `launchReady`, `registrationReady`, `retryInstallation`, `offerShown`, `arriveHome`, `setOfferVisible`, `dismissOffer` and `onUpdateShown`. Call `createLaunch(context, { serviceWorkerUrl, soundFormat, onProgress, onFailure, onNetworkPlay, onUpdateReady, onUpdateState, onRequireNewer })` once, with the `context` of a `supported` `prepareBrowserLaunch` result (see [Grouped updates](#grouped-updates)), and `await run()` before game construction or save access; `"reloading"` means do not start the game. `requireNewer()` keeps its behaviour, and `RequiredUpdateState` moves to `dom/launch`.
- The required `soundFormat` (`string | undefined`) replaces the worker URL's `?sound=<format>` parameter (`web/pwa/serviceWorkerUrl`): pass the format the page plays, chosen as before, for example the first one an audio element's `canPlayType` accepts. Each build installs, counts in progress and checks for completeness only the sound alternatives whose URL extension is that format, none of a sound without one, plus every other file. The page saves the build's manifest reduced to that choice and records the format with it, so the installer, launch and the router's staged promotion agree. A left-out alternative goes to the network if requested. `undefined` installs every alternative, as a game without sounds passes.
- A site page that does not run the launch, such as `/`, calls `registerRouter(navigator.serviceWorker, serviceWorkerUrl)` from `runtime/web/pwa/dom/launch`. It registers the router (`updateViaCache: "none"`) without installing, so an app installed from that page opens through the router, offline once a launch has installed a build. It resolves `false` where the browser has no service workers or registration fails.
- `onUpdateReady({ version, updateNow, dismiss })` replaces the home-screen offer. It fires once per staged version, on any screen; the game draws its own Update now prompt and pauses play. `updateNow(save)` awaits the game's save, then activates the staged build and reloads with no download. `dismiss()` continues play on the active build, and the next launch applies the update silently.
- `LaunchProgress` (`{ phase, value, receivedBytes, totalBytes }`, one determinate value over the first install and the boot reads) replaces `InstallationState`, `OfflineActivity` and `DownloadProgress` for the first install. Have the boot loader call `launch.bootProgress(done, total)`. After the first install reloads into the router, `run()` reports the carried value at once, so the bar keeps its value until the boot loader's first read. Show Loading failed only from `onFailure({ reason, retry })`, with Retry wired to `retry`; `reason` is `network` or `verification`. Where the device cannot install, `run()` calls the required `onNetworkPlay({ reason })` once and then resolves `"play"`, and the game plays from the network: `reason` is `unsupported` when the router cannot register and `quota` when storage is full (`NetworkPlayNotice` in `runtime/web/pwa/buildContract`). The game shows its own notice, such as "Playing online: this device could not install the game"; the kit renders nothing. Each later launch tries the install again, reusing stored files. Background updates report only `UpdateState` (`idle`, `staging`, `ready` or `failed`) through `onUpdateState`, never Loading failed; a failed one retries while the page stays visible, after 60 s and then twice the previous wait up to 15 minutes.
- The worker entry calls `runServiceWorker(policy)` with no manifest; delete its `PrecacheManifest` and `GAME_KIT_PRECACHE_MANIFEST` uses. The worker downloads nothing, calls `skipWaiting` and `clients.claim`, serves each window its pinned build, or the active one, and leaves `cache: "no-store"` requests to the network. The installer fetches unhashed files with `no-store` and files under `hashedAssetPrefix` in the default mode, so the HTTP cache or the router may answer them with the same bytes.
- `build/precachePlugin` no longer writes a manifest into the worker. It emits the pointer `/.game-kit/build.json` and one `/.game-kit/manifest-<version>.json` per build. Serve `build.json` with `Cache-Control: no-store`, so no CDN or browser cache keeps it, and each manifest as immutable. Remove the `groups` option.
- Asset groups are removed: `web/pwa/assetGroups`, `web/pwa/dom/assetGroups`, `web/pwa/precacheGroups`, the group store and the activation barrier. The complete build installs before first play; boot loads every group behind the one loader.
- Also removed: `web/pwa/updateReady`, `web/pwa/downloadProgress`, `web/pwa/dom/downloadProgress`, `web/pwa/serviceWorkerUrl` (register the plain worker URL and pass the sound format as `createLaunch`'s `soundFormat`), `runtime/web/pwa/precacheManifest` and `build/precacheList`'s `PrecacheManifest`, the old worker's `cachePolicy` helpers (`strategyFor`, `cachedUrlsOf`, `installUrls`, `installPlan`, `digestContentHash`, `precacheFetchOptions`, `cacheNameFor` and `staleCacheNames`), and `precacheFingerprint`'s grouped argument, so it is `precacheFingerprint(policy, contentHashes, byteSizes?, verifiedJsonBodies?)`.
- New paths: `runtime/web/pwa/buildContract`, `build/buildManifest`, `runtime/web/pwa/dom/buildStore` and `runtime/web/pwa/dom/buildInstaller`.
- The first launch on the router finds no active build and installs under the loader. It copies each file an old version cache holds with the manifest's size and SHA-256, then deletes the old version caches, routing records and asset-group database. Saves are unchanged.

## Verified JSON response headers in 0.58.1

Fix. A verified JSON response no longer fails on a header name outside a fixed list, so browser fetches through a CDN that adds `priority` or `server-timing` install. Only `clear-site-data`, `content-disposition`, `content-location`, `content-range`, `refresh` and `set-cookie` fail it, alongside the existing content-type, cache-control, vary, encoding, length, nosniff, redirect and source URL checks. No game change is needed beyond the version.

## Exit availability in 0.58.0

Additive. `runtime/web/pwa/appWindow` exports `canExitApp(createCloseWatcher, host)`: true only where the page runs in an installed app's window that a script can close, so a start screen shows Exit only there. It is `runsInAppWindow(host) && !appCannotClose(createCloseWatcher, host)`; read it as the page loads, and call `exitApp` when Exit is chosen.

## Build output

`build/precachePlugin` builds the worker entry through Vite's isolated worker pipeline as one self-contained classic script, which embeds no manifest. Shared page modules cannot split it into ESM chunks, and the build rejects worker imports or additional emitted files. Games keep classic registration through `createLaunch`.

The plugin also writes the build's manifest at `/.game-kit/manifest-<version>.json` (`buildContract`'s `buildManifestUrl`) and the pointer at `/.game-kit/build.json` (`BUILD_POINTER_URL`). The manifest lists every file the complete build needs offline under the URL the page requests, with its full SHA-256 and exact byte size: the page, the build output it loads, the public files it links, the web app manifest's icons and the files `hashedFiles` names, every sound alternative included; each alternative's URL extension names its format, and the page installs only the alternatives in its `soundFormat`. It also records each sound's alternatives, the `boot` files the game reads after install and any verified JSON families. The version changes with any listed file's content and with the build ID, sounds or boot files. The pointer names the version, its build ID and its manifest URL. `build/buildManifest` constructs and strictly validates both; the page and the router read them with checks that ignore fields a later kit version adds.

## Dialog-subtree isolation

`runtime/web/ui/dom/modalLayer` accepts `ModalOptions.isolation: "dialog"` to keep only the top dialog subtree interactive. Omission or `"layer"` retains the existing containing-layer behaviour. Strict mode rejects nonempty `live` exceptions. Optional `backdrop` names the exact element allowed to receive pointer actions outside the dialog; its other descendants are not allowed. The caller retains the original outside-dismissal callback and mandatory-choice policy.

Strict mode keeps the dialog's ancestor paths live and makes their other branches inert. It does not move, hide, style or dim the underlying UI. Only manager-owned inert marks are restored; nested close and focus restoration retain the existing stack. Owned-root capture guards block outside pointer and activation events, while a child-list observer updates inert branches for inserted controls. Keyboard focus and mapped actions stay within the top dialog, including close keys when no close callback exists. The focus order skips controls in a `data-ui-pending` subtree until the marker is cleared.

Handled action keys stop before later listeners on the same root. After focus falls to a neutral document target, Tab and the mapped arrow keys recover focus inside the valid top strict dialog. Forward and reverse navigation start at the first and last eligible controls, respectively. Neutral activation and close keys remain contained. Unmapped editing keys and legacy-mode handling remain unchanged.

Configure and create the manager before delegated action listeners on its root. It cannot suppress an earlier listener on that root or an ancestor capture listener. Keep caller world/Phaser input scopes and cross-modal gesture guards. Dimming, visible layout, allowed navigation and actual backdrop selection remain caller-owned. Invalid strict configurations fail before stack, focus or inert changes.

## Standard game buttons

Import `createButton(document, options)` from `@andornaut/game-kit/runtime/web/ui/dom/button` and load the existing `controls.css`. The returned view owns one stable native button, an optional skin face and a content slot. Text supplies its name. Icon-only content requires a name and accepts a decorative noninteractive element. Update content with `setContent` and presentation with `refresh`. Use `dispose` before releasing the view.

Place the native button in the caller's existing root action registry. Resolve the view through `holdAction()` and use the existing `bindHoldActions` on that root. In pointer-release mode return the same action from the physical resolver and use `setPressed` in the existing press feedback callback. Route click capture through the existing readiness and modal guards. Return `null` from `getAction` while a caller guard blocks activation. Keep only the renderer's native click handler on the button. Supply the current callback and change action identity when reusing a button for another logical action. A hold uses the normal callback unless the caller supplies a hold override.

Keep the game's skin, size tokens, placement, labels and navigation callbacks in the caller. `appearance.layout: "caller"` keeps existing geometry. Native disabled controls, focusable unavailable controls with a reason, selected styling, toggle semantics and momentary press feedback remain distinct. Use separate native form and continuous input paths for submit, steering, drag, sliders and editing.

**Refused.** Return `{ kind: "refused" }` as the availability from `getState` for an option the player can reach but not take, such as a choice card they cannot afford. The button stays enabled, focusable and in the Tab order, with no description or reason, and is `aria-disabled="true"`, which the kit sets on every refresh while the state holds. Style it on `[aria-disabled="true"]`: pointer refusal and unavailable set the same attribute, and the kit's theme, frame and HUD disc stylesheets already draw it as disabled. Enter, Space and pointer presses and holds under a current action play `refusal`, a `ButtonRefusal`: with `{ cue, reducedMotion }` the `refusalCue` `refuse`, leaving a cue already playing there to finish, and with `{ refuse, reducedMotion }` the game's `refuse(reducedMotion, control)` in its place, with `reducedMotion()` read at that refusal and the refused button, as the pager's `refusal` does (`PagerRefusal` is `ButtonRefusal`). `refuseButton(refusal, control)` plays a refusal the same way on any control: `ButtonRefusal<Control>` takes the refused element's type, `HTMLButtonElement` by default. Without `refusal` a refused press does nothing. Focus and press stay fills. Form rows and HUD discs take the same state and option. Pointer refusal, unavailable and every other state are unchanged.

```ts
const card = createButton(document, {
  appearance: { className: "choice-option", layout: "caller" },
  content: { kind: "icon", name: cardName },
  getAction: () => ({ activate: () => choose(index) }),
  getState: () => ({ availability: { kind: entry.enabled ? "available" : "refused" } }),
  // playRefusal(reducedMotion, control)
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
  rule: HOLD_RULE,
});
```

The loading-failure presenter keeps its asset-independent inline fallback and adds a themed keyboard-focus cue when the browser exposes the necessary focus and forced-colors features. Native focus remains visible on the fallback path. Retry still uses its existing single-flight and input guards.

## Action groups and UI theme

`runtime/ui/actionGroup` lays out a group of action faces and owns the spacing between them. `arrangeActions(context, items)` takes each face's size in whole game units: its outer ink bounds with the lip included, from data (`BUTTON_SIZE`) or measured labels plus padding. Fitting uses full font sizes only: a row that does not fit `width` stacks, and a stack wider than `width` throws `RangeError`. Hidden items keep their identity, take no space and do not count. Secondary actions keep the caller's order and at most one visible primary goes last, rightmost in a row and at the bottom of a stack. A sole visible action is centred. Results stay in the caller's order with each visible action's `face`, `press`, `outset` and visual `order`.

- **Gaps:** `gap` is `"standard"` (`BUTTON_GAP` across, `STACK_BUTTON_GAP` stacked), `"small"` (`SMALL_BUTTON_GAP` both ways) or a named override `{ name, row, stack }` for an exempt layout. Action gaps are separate from layout tree `gap` and `padding`.
- **Press areas:** `press` is the hit rule (default `HIT_RULE`, its margin rounded up and grown to `minTarget`) or `{ margin }`. Toward a neighbour an outset is clamped to its share of the space between the faces, so press areas meet without overlap and never change layout. A clamped press area can be smaller than `minTarget`. With `pressOverlap: "nearest"` each `press` keeps its full size and may overlap a neighbour's; `pressedAction(arrangement, point)` routes a press to the action whose face centre is nearest, the earlier in the caller's order on a tie (`hitAreas` `pressedArea`). Each `outset` is then the part of the press area where its face is nearest along the axis, cut at a whole unit, so the DOM group's hit testing routes the same way. Toward a footer's middle slot outsets clamp in both modes.
- **Whole units:** every input and output is a whole unit. Where a length splits unevenly, the odd unit goes right or below: centring puts it after the content and the later of two neighbours takes it of the space between them. `project: { x(edge), y(edge) }` maps edges to the caller's space, such as integer device pixels, and must be nondecreasing with whole results; neighbours share projected edges. `origin` offsets the group.
- **Stacks:** faces stretch to the widest face (`stackWidth: "content"`, the default) or the whole room (`"fill"`). `locked: true` keeps an art-locked face at its size, centred in the column.
- **Footer:** `variant: "footer"` pins secondary actions from the left edge and the primary at the right edge, with an optional `middle` slot (such as a pager) centred in the room, each at least the row gap apart. A sole action without a middle slot is centred. A footer that does not fit stacks with the middle slot first.
- **Text:** `placeText(face, item)` receives each projected face and its result is returned as `text`. Without it text placement stays with the game.

`runtime/web/ui/dom/actionGroup` applies an arrangement in base px at `--ui-unit` with `actionGroup.css`. The game appends its action elements, such as `createButton` views, to `element` in its focus order. `arrange(context, actions)` takes `{ element, role, size, locked? }`, reads `element.hidden`, and places each direct child absolutely by its face; the DOM order, focus order and classes stay the game's. Each action's `::before` is its press area, outset by the arranged amounts, so the browser's hit test takes it as the action; a clipping ancestor clips outsets that reach past it. `measure(elements)` returns natural face sizes in whole base px, rounded up, at max-content.

```ts
import { createActionGroup } from "@andornaut/game-kit/runtime/web/ui/dom/actionGroup";

const group = createActionGroup(document);
group.element.append(back.element, resume.element);
const [backSize, resumeSize] = group.measure([back.element, resume.element]);
group.arrange({ width: CARD_CONTENT_WIDTH }, [
  { element: back.element, role: "secondary", size: backSize! },
  { element: resume.element, role: "primary", size: resumeSize! },
]);
```

**Projection in the DOM.** `arrange` and `arrangeGrid` also take the pure context's `project`, with `origin` the group's corner in the game's units (`origin` takes `project`), for a game that places its kit on its own pixel grid. The group then takes `data-ui-action-projected` and writes its box, each face, the middle slot and each press outset in whole CSS px between projected edges (`--ui-action-length: 1px`) instead of base px at `--ui-unit`, from the group's projected corner, `arrangement.group.x` and `.y`, where the game places the element; neighbours share projected edges, so press areas still meet without overlap. Arranged without `project`, the group is in base px again.

**Grids.** `arrangeActionGrid(context, items)` lays actions out in rows of at most `columns`, such as two-column cards, with the same items, gaps, `press`, `pressOverlap`, `origin`, `project` and `placeText`. Cells share one width: the widest face (`cellWidth: "content"`, the default) or the room split evenly (`"fill"`); a `locked` face keeps its size, centred in its cell. Visible actions fill the rows in visual order with the primary last, rows the stacked gap apart and columns the row gap apart. A short last row is a centred row of its faces, so a sole action is centred; there is no start-aligned option. A grid that does not fit `width` at full size takes fewer columns, down to one, and a column wider than `width` throws `RangeError`. Press areas clamp toward every neighbour along and between rows, so they meet without overlap. The result has `axis: "grid"` and the `columns` and `rows` placed; `pressedAction` takes it as it takes a group's. The DOM group's `arrangeGrid(context, actions)` places it as `arrange` does.

**Press clamping between groups.** `separatePressAreas(members)` clamps the press areas of neighbouring members toward each other by the rule a group uses inside: each takes its share of the space between two faces, the earlier (left or top) the lower half and the later the odd unit, so press areas from different groups, or from a group and a box that is its own press target (a form row), meet without overlap and need no stacking order or inset. Members are arrangements and boxes in one space (arrange each at its `origin`, with the same projection); a box keeps its area, and inside a member nothing changes, so `pressOverlap: "nearest"` keeps routing its own actions. Faces of two members that overlap, such as content scrolled under a footer, stay as they are. In the DOM, `createPressContext(root)` holds the members: `add(group)` (a view that wraps a group, such as a modal frame's `footer`, is that group) and `add(element)` for an element whose box is its press target, such as a form row; `apply()` measures each shown member's layout position under `root` in whole base px at its `--ui-unit`, its box as drawn less the CSS `translate` of the member and of each ancestor below `root`, so a refusal shake or press shift that is playing moves no clamp, and writes each group's clamped outsets. A member group's `arrange` and `arrangeGrid` apply it again; apply after anything else moves a member, such as a frame's `layout`. `remove(member)` restores a group's own outsets. With projected groups, `apply()` measures nothing: the members are in the projection's space, each group as arranged and each element at its placed form row box (a placed list's row), and every group must be projected with the same projection (`RangeError` otherwise).

```ts
import {
  createActionGroup,
  createPressContext,
} from "@andornaut/game-kit/runtime/web/ui/dom/actionGroup";

const menu = createActionGroup(document);
menu.element.append(achievements, settings, cheats, home, resume);
menu.arrangeGrid({ cellWidth: "fill", columns: 2, width: CARD_CONTENT_WIDTH }, [
  ...[achievements, settings, cheats, home].map((element) => ({
    element,
    role: "secondary" as const,
    size: TEXT_BUTTON_SIZE,
  })),
  { element: resume, locked: true, role: "primary", size: resumeSize },
]);

const presses = createPressContext(frame.card);
presses.add(unlocks);
presses.add(invincibility.element);
presses.add(frame.footer);
frame.layout(context, parts);
presses.apply();
```

`runtime/ui/uiTheme` and `runtime/web/ui/dom/uiTheme` with `uiTheme.css` supply the theme. `setUiColours(colours, root)` writes role-named colour slots (`cardFace`, `frame`, `textPrimary`, `textSecondary`, `accent` and the button face and text states) from `0xRRGGBB` numbers or `#rrggbb`/`#rrggbbaa` strings as `--ui-colour-<role>` and marks `root` with `data-ui-theme`. Inside it, standard button faces take the idle, primary, selected, pressed and disabled slots, and the focus slots feed the focus fill in `controls.css`, which stays the one focus treatment. State changes only fill and text colour; `--ui-button-press-dip` (base px, default 0) moves a pressed face and a disabled face never dips. Forced colours use `ButtonFace`, `Highlight` and `GrayText` fills. `setTextRoles(roles, root)` writes `{ size, lineHeight, weight }` in base px for the `ui-text-body`, `ui-text-heading`, `ui-text-label` and `ui-text-supporting` classes. `setGameTextRoles(roles, root)` writes a game's own roles beyond those four, by lower camelCase name (`dialogueName` writes `--ui-text-dialogue-name-size` and so on), and refuses a kit role's name; `setTextRole(role, element)` gives an element one role, a kit role's class or, for a game role, the `ui-text-role` class with references to its lengths, so a change on the root reaches every element of it. A game role inherits its colour. `ui-button-reset` removes user-agent button styling. Every rule in `uiTheme.css` has zero specificity, so a game's component classes always win, and the stylesheet holds no colour literals.

The kit screens outside the UI layer follow the same roles and slots where a game sets them on an ancestor, such as `setTextRoles(roles, document.documentElement)` and `setUiColours(colours, document.documentElement)`, with role lengths at the `--ui-unit` the screen inherits (1 where none is set). The crash screen (`crash.css`, CSS only, so it needs no game code to have run) takes `heading` for its title, `body` for its text, `label` for Reload and Copy and `supporting` for the dev stack; `textPrimary`, `frame` and `cardFace` for its text, panel border and panel face; and the button, primary, focus and pressed slots for its buttons. The dev stack takes `textPrimary` on `cardFace`, the panel body's pair, so a text slot in the ink colour still reads; each falls back on its own to the screen's text on `CrashColours.ink`, so a game that sets `textPrimary` sets `cardFace` with it. Its focused details summary fills from `buttonFocusFace` and `buttonFocusText`, else its own text and backdrop swapped, and from `Highlight` and `HighlightText` in forced colours, with no outline. The loading failure and capability error card (`mountLoadingFailure`, and `prepareBrowserLaunch`'s unsupported card) takes `heading`, `body` and `label` for its title, text and Retry; `cardFace`, `textPrimary` and `frame` for its panel, text and borders; and the primary, focus and pressed button slots for Retry. Each value falls back to the screen's own: `CrashColours` and its 22, 16 and 12 px monospace type, or the card's `presentation` sizes and palette, else its native system fallback. A page that sets none renders as before, apart from the summary's focus fill. Lip, shadow, highlight and shade colours, the panel geometry and forced-colours fills take no slot.

**Button frames.** The opt-in `buttonFrame.css` gives a nine-slice frame of any size the button state rules: the face itself, or a layer inside the button, with the `ui-button-frame` class (`BUTTON_FRAME_CLASS`). It follows the button's `data-ui-button-role="primary"`, `data-ui-selected`, `data-ui-pressed` and disabled state, the last matching state winning in that order. The game points `--ui-button-frame-image`, `--ui-button-frame-slice` and `--ui-button-frame-width` (a whole-pixel length, as `--ui-frame-width`) at its idle frame's properties, and the same three for `primary`, `selected`, `pressed`, `primary-pressed` and `disabled` (such as `--ui-button-frame-primary-pressed-image`); one left unset takes the idle frame's, a primary pressed one the primary's. Inside the theme root, press and focus keep the frame's edges and fill its inside from the pressed slot and the one focus fill, focus winning; a disabled frame keeps its own centre. Content marked `ui-button-frame-content` moves down `--ui-button-frame-pressed-shift` base px while pressed and `--ui-button-frame-disabled-shift` while disabled, both 0 by default. Forced colours draw a `ButtonText` or `GrayText` edge with `ButtonFace` or `Highlight` inside. Every rule has zero specificity and the stylesheet holds no colour literals.

## Modal frame

`runtime/ui/modalFrame` places a modal frame in whole game units, every length measured from the card's outer edge, so a skin never moves content. `modalFrameRooms(context)` gives the widths the game lays its parts out in (`card`, `title`, `body`, `footer`); `placeModalFrame(context, sizes)` places the `card`, `header`, `title`, scroll `body` with its `bodyInset`, optional `footer` room and `close` face, press target and outsets, and reports whether the body `scrolls`. Invalid input throws `RangeError`.

- **Card:** `families` (the game's width families as data, such as `{ large: 688, medium: 500, small: 400 }`) and `family` set the width, clamped inside `margin` (16) of the game's `content` rect. Height follows content up to the content rect less the margin above and below, past which the body scrolls. The card is centred both ways; the odd unit goes right and below.
- **Full screen:** `variant: "fullScreen"` makes the frame the content rect, its close control anchored to the view's corner and its body the height the header and footer leave.
- **Close:** `close.face` and `close.press` are corner rects, `x` in from the right edge and `y` down from the top. The press target must contain the face and defaults to `HIT_RULE` centred on it; it is never clamped or shifted and may reach past the card.
- **Header:** the title box is the card width less a reserve on each side: the whole close target from the right edge plus the gap, mirrored left, or the padding without a close. The header is the title's height plus its `inset` (default the padding) above and below, and at least the close target's bottom plus the gap and `bodyOutset`. The title is centred in it, then moved by the game's whole-unit `inkOffset`.
- **Body and footer:** the body runs from the header to the gap above the footer, with the padding at its sides; without a footer the bottom padding is inside the body. The footer is the padding in from the card's sides and bottom, its height the footer action group's.
- **Projection:** `project` maps every edge as in `arrangeActions`.

`runtime/web/ui/dom/modalFrame` with the opt-in `modalFrame.css` builds the frame: a full-area `element` holding the `backdrop` and the `card` (`role="dialog"` or `"alertdialog"`, `id`, `aria-labelledby` its `<id>-title` and, with `description`, `aria-describedby` its `<id>-text`). The card holds a `skin` layer for the game's CSS face or nine-slice `.ui-frame` (`skinClassName`), the header and `title` (`ui-text-heading`), the scroll `body` with its `content` box the game appends to, the footer `createActionGroup` (`footer`) and the game's close control, kept last in focus order. `layout(context, parts)` measures the title at its room, the content and the footer actions (sizes from `footer.measure`), arranges the footer with `variant: "footer"`, and places every part at `--ui-unit`; lay out again after content, fonts or the content rect change. The close control's box is its face and its `::before` the press target. Every rule has zero specificity; the only colour is `--ui-modal-backdrop`, the dim over covered chrome, unset by default.

`open({ layer, close, focus, input, outsideTap, restore })` opens the card on the game's `modalLayer` in dialog isolation with the backdrop as its only outside target: covered chrome is inert under the backdrop, and the focus returns to the opener on close. `close` is the game's one-layer dismissal, the same action as the close control; Escape, P and back call it, and with `outsideTap: { tapMaxDistance, tapGuard? }` a backdrop tap does too. `input` takes a `modalInput` scope for the session. The returned session's `close()` ends it.

```ts
import { createModalFrame } from "@andornaut/game-kit/runtime/web/ui/dom/modalFrame";

const frame = createModalFrame(document, { id: "restart", skinClassName: "ui-frame", title });
frame.content.append(message);
frame.footer.element.append(cancel.element, restart.element);
modalRoot.append(frame.element);
const [cancelSize, restartSize] = frame.footer.measure([cancel.element, restart.element]);
frame.layout(
  { close: CLOSE, content: SAFE_AREA, families: MODAL_WIDTHS, family: "small" },
  {
    close: closeButton.element,
    footer: {
      actions: [
        { element: cancel.element, role: "secondary", size: cancelSize! },
        { element: restart.element, role: "primary", size: restartSize! },
      ],
    },
  },
);
const session = frame.open({ close: dismiss, focus: restart.element, input: gate, layer });
```

### Pages, untitled frames and projection

Each addition is opt-in; a frame that uses none of them is placed and opened as before.

- **Page:** `variant: "page"` is placed as a full-screen frame and is not modal. After a `page` layout the DOM frame hides its backdrop and `open({ focus, input, restore })` takes no `layer`, `close` or `outsideTap`: it focuses `focus` or the card, sets no `aria-modal` and no `inert`, so covered chrome such as a top bar stays live, and closing returns the focus to the opener unless the player moved it to live chrome. A card or full-screen frame still needs `layer`.
- **Insets:** `insets: { side, bottom }` (each default the padding) set the body content's and footer's side inset and the footer's (or, without a footer, the body content's) bottom inset; the title keeps the padding.
- **Untitled:** omit `sizes.title` for a frame without a title. Its header is the padding, or the close clearance when that is taller, and `title` is an empty box. In the DOM, omit `title` and pass `label`: the dialog takes `aria-label`, the title element is hidden and `setTitle` throws.
- **Backdrop:** `context.backdrop`, a whole-unit rect in the content rect's space, places the backdrop independently of the frame, such as over letterbox bars; round a fractional cover outward. Omitted, the backdrop fills the frame root as before.
- **Projection in the DOM:** with `project`, the frame root takes `data-ui-modal-projected` and every placed length is whole CSS px on the game's grid (`--ui-modal-length: 1px`) instead of base px at `--ui-unit`, and the body's side and bottom insets are each projected. The game then supplies `parts.title.height` and `parts.body`: the frame does not measure across the projection. A kit footer (`parts.footer.actions`, sizes from data or `footer.measure`) is arranged on the frame's grid with the frame's own projection from the footer room's corner, so a projected page can use the footer action group.
- **Game-owned parts:** `parts.title.height` sets the title box's height for a title whose content the game places, such as ink-placed glyph runs inside `frame.title`. `parts.footer: { height }` reserves the footer room for the game's own footer, appended to `frame.footerSlot`. `layout()` also returns `units`, the layout before projection, so the game places its ink and controls from the same rects.
- **Game scroll:** `parts.scroll: "game"` stops the body's native scroll, clip and pan; the game moves and clips its content, such as by a scene-driven transform in its own clip.
- **Footer measure:** `frame.footer.measure()` shows the footer slot while it measures, so actions measure before the first layout.

```ts
// Archie's Pet shop page under its live top bar, on its device art-pixel grid.
const page = createModalFrame(document, { id: "shop", title: "Pet shop" });
const spans = titleLines.map((line) => createTextLine(document, line));
page.title.replaceChildren(...spans);
page.footerSlot.append(back);
layer.append(page.element);
const { units } = page.layout(
  {
    content: { height: 520, width: 360, x: 0, y: 40 },
    insets: { bottom: 12, side: 8 },
    project: { x: (edge) => gridX(scale, edge), y: (edge) => gridY(scale, edge) },
    variant: "page",
  },
  { body: listHeight, footer: { height: 48 }, scroll: "game", title: { height: 15, inset: 24 } },
);
titleLines.forEach((line, i) => placeText(bitmap, scale, units.title, spans[i], line));
placeBox(scale, units.footer, back, backRect);
const session = page.open({ focus: back });

// Chibi's untitled card, its backdrop over the letterbox bars.
const card = createModalFrame(document, { id: "stages", label: "Stage select" });
card.layout(
  { backdrop: SCREEN_COVER, content: VIEW, families: CARD_WIDTH, family: "large" },
  { footer: { actions } },
);
```

## Switch, form rows, pager and HUD disc

Each component keeps pure state and geometry in `runtime/ui/<component>` and its DOM part in `runtime/web/ui/dom/<component>` with an opt-in `<component>.css`. Every rule has zero specificity, lengths are unitless base px at `--ui-unit` from the game's tokens, colours are the `uiTheme` slots with system colours in forced-colours mode, `controls.css` owns the one focus fill, and every label is player text. Invalid input throws `RangeError`.

**Form rows.** `createFormRows(document, layout)` makes the list; `createFormRow(document, options)` makes a row, one standard button (`createButton`), so the whole row is the press target with the kit's hold, availability and refusal paths. A row holds an optional `icon` (one state-free frame of the game's art), its `label` and optional `note` (its description), and a trailing value stack. With `switch: true` the row is `role="switch"` with `aria-checked` from `getState().checked`, and the stack shows the game's `ui-switch` art (`--ui-switch-on-image`, `--ui-switch-off-image`, such as a button skin's cut frames) over the state word `getState().value` (On, Off, Shown or Hidden); without it `value` is a described value. The list is a grid whose icon, label and value columns every row shares as a subgrid, so the value column is the widest value stack (or `value.track`, a fixed width) with no script measurement. `runtime/ui/formRow` `formRowPresentation(layout)` turns the game's `FormRowLayout` into the list's properties: `height`, `columnGap`, `padding`, `align` (`"center"` or `"start"` with icon and value `offset`s), the `icon` slot and size, the art-locked `switch` size, and the state word's `value.state` (`"center"` under the switch, or `"end"` with its ink's right edge on the switch's by `value.bearing`) and `value.gap`. Rows are `gap` apart, `ACTION_GAPS.standard.stack` by default. In the theme rows have a clear idle face and no press dip; state changes only the fill. A row with `pressDip` (whole units) moves its art, every child but a one-action row's face, down that far while pressed, never while disabled; the row and its press target stay put. A centred switch keeps whole-unit placement with the odd unit right when its column's right edge is whole; a `track` keeps it independent of the words' widths. A row refuses as its button does: a refused row (`{ kind: "refused" }`), value or switch, plays `refusal` on Enter, Space, pointer presses and holds, and with `{ refuse, reducedMotion }` calls the game's `refuse(reducedMotion, control)` with the row's button and never the kit cue. Pointer refusal calls only `onPointerRefusal`, never `refusal` or the kit cue, so a game plays its own cue there, such as `onPointerRefusal: () => playRefusal(reducedMotion(), row.element)`.

```ts
import { createFormRow, createFormRows } from "@andornaut/game-kit/runtime/web/ui/dom/formRow";

const rows = createFormRows(document, {
  columnGap: 8,
  height: 48,
  icon: { size: 16, slot: 24 },
  switch: { height: 16, width: 32 },
  value: { gap: 4 },
});
const fps = createFormRow(document, {
  getAction: () => ({ activate: toggleFps }),
  getState: () => ({ checked: settings.fps, value: settings.fps ? words.on : words.off }),
  icon: fpsIcon,
  label: words.fpsCounter,
  rule: HOLD_RULE,
  switch: true,
});
rows.element.append(fps.element);
```

**One-action rows.** `createFormRow(document, { action: { size, className, role }, label, icon, ... })` makes a row whose only content is one standard button face of `size` (whole units), in the game's `className` and `role`, centred in the whole row, the list's padding included, with the odd unit right and below. The face holds the optional `icon` and the `label`; `view.face` is the face. The row stays the button, so its press target is the whole row with no outsets, and it takes the list's gap and the press context like any row. The face takes the standard button face's theme fills and focus fill and dips by the theme's `--ui-button-press-dip`, which the list sets to 0 and the game may set on the row. A one-action row takes no `switch`, note or value. This is the smaller shape than per-edge press margins on rows: a form row is already one press target, so a face inside it covers the row without margins, clamps or a second hit area.

```ts
// Archie's Install row: the sole action's 145x33 face, the whole row its press.
const install = createFormRow(document, {
  action: { className: "adw-face", role: "secondary", size: { height: 33, width: 145 } },
  getAction: () => (accepts() ? { activate: startInstall } : null),
  icon: installIcon,
  label: words.install,
  rule: HOLD_RULE,
});
```

**Placed lists.** For a game that places its kit on its own pixel grid, `rows.place({ project, width, origin }, rows)` places the list through the game's projection (`ActionProjection`, as for `arrangeActions`) instead of CSS sizing. `rows` are the list's own kit rows (`createFormRow`, `createSlider`) in its order; the shown ones are each exactly their own height, each its gap below the one before from `origin`, `width` units wide. A row's height is an entry's own, `{ element, height }` in whole units, or a slider's `layout.height`, or the layout's `height`, so rows of different heights share one list; its track, padding, icon, switch, lane, art and press dip follow that height. A row's gap is the layout's `gap`, or an entry's own: `{ element, gap }` sets the whole units above that row, ignored on the first shown row. The list takes `data-ui-form-projected` and writes its grid as explicit CSS px tracks between projected edges (`--ui-form-columns` and `--ui-form-rows`): the padding, the icon slot's sides and the column gaps are tracks of their own and each row track is its pitch to the next, so the rows' subgrids share whole-pixel columns. Each row's padding, icon, switch, state word gap and bearing, and a slider's line, gap, insets, lane, track, caps, fill and thumb are written in whole CSS px between their projected edges (`--ui-form-length: 1px`); text keeps its CSS alignment. With `artPixel`, the whole CSS px of one art pixel, art-locked parts keep their art size: icons, switches, a slider's thumb, its track's and fill's height and its caps are their units times `artPixel` from their projected corner, never stretched by snapping each edge, while rows, columns, the lane and the track's and fill's widths stay on projected edges. An icon starts at its column's left edge, and an end-placed state word's ink ends on the switch as drawn. A one-action row's face is centred in the whole row and placed by its projected edges, and a press dip is `pressDip` art pixels, or without `artPixel` the projected length from the row's top. The layout needs `value.track`; `value.height` gives a centred switch row's stack height (the switch's by default), and a slider's `layout.line` its first line's height, since a placed list measures nothing. The game puts the list element's corner at the projected `origin`. `place` returns `placed`, the projected layout, and `units`, the same layout in units (`runtime/ui/formRow` `formRowsGeometry`), for the game's own ink. `setLayout` places a placed list again; place it again after rows show, hide or change their layout, or the projection changes. A placed row is a press context member at its placed box.

```ts
// Archie's Settings on its device art-pixel grid, its ink and art drawn from units: one list of
// 82 and 48 unit rows.
const grid = { x: (edge: number) => gridX(scale, edge), y: (edge: number) => gridY(scale, edge) };
const rows = createFormRows(document, {
  align: "start",
  columnGap: 4,
  // A separator and its clearance between rows.
  gap: 17,
  height: 82,
  icon: { offset: 9, size: 16, slot: 16 },
  padding: { bottom: 0, left: 6, right: 8, top: 0 },
  switch: { height: 16, width: 32 },
  value: { gap: SWITCH_STATE_GAP, offset: 9, state: "center", track: 46 },
});
const music = createSlider(document, {
  ...musicOptions,
  layout: { art: SLIDER_ART, height: 56, inset: { left: 20, right: 0 }, line: 27 },
});
// Switch rows dip their art 1 unit while pressed.
const sound = createFormRow(document, { ...soundOptions, pressDip: 1, switch: true });
// Install's face is centred in its whole row, padding included.
const install = createFormRow(document, {
  ...installOptions,
  action: { role: "secondary", size: { height: 33, width: 145 } },
});
rows.element.append(sound.element, music.element, effects.element, motion.element);
rows.element.append(install.element, fps.element);
const { units } = rows.place(
  { artPixel: artPixel(scale), origin: { x: 8, y: 103 }, project: grid, width: 330 },
  [
    sound,
    music,
    effects,
    motion,
    { element: install.element, height: 48 },
    { element: fps.element, height: 48 },
  ],
);
// Cheats: adjacent switches touch, other rows the list's gap apart.
cheats.place({ artPixel: artPixel(scale), origin, project: grid, width: 344 }, [
  invincible,
  { element: ghost.element, gap: 0 },
  resetSave,
]);
placeBox(scale, ORIGIN, rows.element, units.list);
```

**Pager.** `runtime/ui/pager` `arrangePager(context, sizes)` is the action group arrangement of Previous, the count and Next in one row, `PAGER_GAP` (8, a button and its copy) or another gap token on both sides of the count; the buttons' press areas clamp to half the gap toward the count, which takes no presses. `pagerState(page, pages)` says which steps are available, and `pagerSize(sizes)` sizes the pager as a footer's `middle` slot. `createPager(document, options)` builds it on `createActionGroup`: two standard buttons in the game's `appearance` with the count between them in focus order, announced politely, as `countText(state)` or with `dots: true` as decorative dots (`--ui-pager-dot-size`, `--ui-pager-dot-gap`; accent for the current page, frame for the others) that take no focus. An unavailable step is disabled, or with `refusal` a pointer refusal that leaves the Tab order and is refused on a press. `pager.refuse(direction)` refuses a step for the game's key in the same way. With `refusal: { cue, reducedMotion }` a refusal plays `refusalCue` `refuse` on the step, leaving a cue already playing there to finish; `stopRefusal()` stops a playing cue, such as when the page or scene changes, and `dispose()` stops it too. With `refusal: { refuse, reducedMotion }` every pointer and key refusal calls the game's `refuse(reducedMotion, control)` with the refused Previous or Next button in place of the kit cue, its arguments in the kit `refuse`'s order, and the game owns its cue's replay and stopping: the pager never calls the kit cue, and `stopRefusal()` and `dispose()` leave the game's cue alone. `active()` is the caller's guard, for presses and `refuse` alike. `arrange({ width })` measures and places the parts; pass `pager.element` and `pagerSize` as a footer group's `middle`.

```ts
import { createPager } from "@andornaut/game-kit/runtime/web/ui/dom/pager";

const pager = createPager(document, {
  appearance: TEXT_BUTTON,
  countText: ({ page, pages }) => words.page(page + 1, pages),
  labels: { next: words.next, previous: words.previous },
  rule: HOLD_RULE,
  state: () => pagerState(page, pages),
  step: (direction) => showPage(page + direction),
});
card.append(pager.element);
pager.arrange({ width: CARD_CONTENT_WIDTH });
```

A game with its own refusal cue passes it as `refusal.refuse` and refuses its key steps through the pager:

```ts
const pager = createPager(document, {
  // ...
  // playRefusal(reducedMotion, control)
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
});
onKey("ArrowLeft", () => (page === 0 ? pager.refuse(-1) : showPage(page - 1)));
```

**HUD disc.** `createHudDisc(document, options)` is one round standard button whose box is the face, at the size token `size` names in `sizes` (`{ face, icon }`, such as two sizes per game). Lay it out and give it its press area as an action group's action, alone or with neighbours (`gap: "small"`, and `pressOverlap: "nearest"` where presses must keep the full minimum target). The face takes the theme's button slots and the focus fill, `--ui-hud-disc-edge` for an edge drawn in every state, the game's face `art`, and `--ui-hud-disc-image` with its focus, pressed and disabled variants for art faces; a pressed face takes the game's `--ui-button-press-dip`. The game's own face fill draws over those, inside the edge and under the art and icon: `--ui-hud-disc-fill`, a ring `--ui-hud-disc-ring` base px wide in `--ui-hud-disc-ring-colour`, sitting `--ui-hud-disc-ring-inset` whole base px inside the edge (0 by default) with the state's fill between, an outer rim `--ui-hud-disc-rim` base px wide in `--ui-hud-disc-rim-colour` at the disc's edge, `--ui-hud-disc-rim-inset` whole base px inside the edge (0 by default) with nothing painted beyond it, all the same in every state, and the icon's `--ui-hud-disc-ink`, each colour with `selected`, `focus`, `pressed` and `disabled` variants (such as `--ui-hud-disc-focus-fill` and `--ui-hud-disc-focus-rim-colour`), the last matching state winning in that order. The rim takes the outer part of the band between the disc's edge and the ring, so the ring inset is at least the rim inset plus the rim; a disc drawn 1 unit inside its face with a 1 unit rim and a 2 unit ring sets `--ui-hud-disc-rim-inset: 1`, `--ui-hud-disc-rim: 1`, `--ui-hud-disc-ring-inset: 2` and `--ui-hud-disc-ring: 2`, and needs no ring art. A state's fill or ink left unset shows the theme's for that state, and its ring or rim colour keeps the idle one; in forced colours the game's fill layer (fill, ring and rim) and ink step aside. State changes only the face fill or image and the icon colour, never the disc or press geometry; in forced colours the art steps aside for system fills. The `icon` (the game's SVG in `currentColor`, or art) fills its icon box, and `runtime/ui/hudDisc` `hudDiscIconOffset(size, bearings)` centres its ink, the box less its side `bearings`, on the face with the odd unit right and below; `hudDiscGeometry` projects both for a canvas.

```ts
import { createHudDisc } from "@andornaut/game-kit/runtime/web/ui/dom/hudDisc";

const pause = createHudDisc(document, {
  bearings: PAUSE_ICON_BEARINGS,
  getAction: () => ({ activate: openPause }),
  icon: pauseGlyph,
  name: words.pause,
  rule: HOLD_RULE,
  size: "large",
  sizes: HUD_DISC_SIZES,
});
hud.element.append(pause.element);
const { face } = pause.size();
hud.arrange({ gap: "small", width: face }, [
  { element: pause.element, role: "navigation", size: { height: face, width: face } },
]);
```

## Slider

`runtime/web/ui/dom/slider` `createSlider(document, options)` with `slider.css` (load it after `formRow.css`) makes a slider row for `createFormRows`' list: a form row whose first line takes the list's columns, with the optional state-free `icon`, the `label` and optional `note`, and the value word `getState().value` (player text, such as 50% or Muted) in the value column, placed as the list places a state word (`value.state` and `value.bearing`, so `"end"` puts its ink's right edge on the column's). Under that line the lane spans the row's content, `layout.gap` below it and `layout.inset` in from its sides. The row is `role="slider"` with `aria-valuemin` 0, `aria-valuemax` `steps`, `aria-valuenow` the step and `aria-valuetext` the value word. ArrowLeft and ArrowRight move one step, Home and End to the ends. A mouse or pen press anywhere on the row drags the thumb's centre along the track; a touch drags once it travels `slop` base px sideways, a tap sets the step where it lifts, and a vertical travel is left to the browser's scrolling (`touch-action: pan-y`). `change(step)` sets the value and `commit(step)` follows a key change or an uncancelled drag or tap. With `getState().refused` the row is `aria-disabled`, keeps its focus and value, shows the disabled art and plays `refusal` on a press, a drag or a step key. `refusal` is a `SliderRefusal` (`ButtonRefusal<HTMLElement>`): `{ cue, reducedMotion }` plays the `refusalCue` `refuse` on the row, restarting a cue already playing there, and `{ refuse, reducedMotion }` calls the game's `refuse(reducedMotion, control)` in its place on every refusal, with `reducedMotion()` read at that refusal and the slider row, as the pager and standard buttons do. The slider then never calls the kit cue's `refuse`, `refusing` or `stopRefusal`, and the game owns its cue's replay and stopping. `active()` is the caller's guard.

The game's art is at its locked size: `layout.art` gives the thumb's size and the track's height and three-slice caps (one art pixel per unit), and the game sets `--ui-slider-track-image`, `--ui-slider-fill-image` and `--ui-slider-thumb-image`, their `-disabled-image` variants and `--ui-slider-thumb-pressed-image`. The track is the lane's width rounded down to a whole unit and the thumb's offset a whole unit, a half rounding right; the fill runs to the thumb's right edge. `layout.height` sets the row's least height where it differs from the list's. In a placed list (`createFormRows` `place`), `layout.line` is the first line's height, which places the lane; the lane, track, caps, fill and thumb are whole CSS px between projected edges, the thumb and fill again at each refresh, and a press maps to units through the track as drawn, so it holds through a scaled root. Inside a theme root the row has a clear idle face and takes the pressed and disabled slots and the focus fill slots `controls.css` uses, filling the row only, with system fills in forced colours. `runtime/ui/slider` holds the pure steps and geometry: `sliderStepForKey`, `sliderThumbOffset`, `sliderStepAt`, `sliderLane`, `sliderGeometry` (projected through an `ActionProjection` for a canvas) and `sliderPresentation`.

```ts
import { createSlider } from "@andornaut/game-kit/runtime/web/ui/dom/slider";

const music = createSlider(document, {
  change: (step) => setMusicVolume(step / VOLUME_STEPS),
  commit: () => saveSettings(),
  getState: () => ({
    refused: settings.muted,
    step: volumeSteps(settings.musicVolume),
    value: settings.muted ? words.muted : words.volume(volumePercent(settings.musicVolume)),
  }),
  icon: musicIcon,
  label: words.music,
  layout: { art: SLIDER_ART, gap: SLIDER_GAP, height: SLIDER_ROW_HEIGHT, inset: { left: 2 } },
  // playRefusal(reducedMotion, control), the game's cue; or { cue: REFUSAL_CUE, reducedMotion }
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
  slop: TAP_MAX_DISTANCE,
  steps: VOLUME_STEPS,
});
rows.element.append(music.element);
```

## Caller action order

Layout primitives retain the caller's keyed order and action roles. Callers place the existing primary action last in vertical groups and rightmost in horizontal groups, retaining secondary order and hidden-control identities. The crash screen keeps Reload after its optional developer details and centres the sole Copy action in its own row. Its action callbacks and focus remain unchanged.

## Explicit pointer-release actions

`runtime/web/input/dom/holdActions.bindHoldActions` accepts optional `activation: "pointer-release"` with `resolvePointer(event)`, `pointerTarget` and `onPressChange(actionOrNull)`. This mode owns both short-release activation and hold dispatch; replace any parallel custom pointerup action listener. The default mode continues to add holds to caller-owned native clicks. Both use the caller's explicit `HoldRule`; there is no numeric duration default.

`allowNonPrimaryTouch: true` additionally admits nonprimary touch contacts with button zero, so a UI action can work while other fingers hold continuous controls. Omission or false retains primary-only eligibility. Nonprimary mouse or pen contacts and nonzero buttons remain excluded. Both modes retain one owned UI gesture, captured/current guards, cancellation and matching release-click suppression. The policy is validated and captured when binding.

`resolvePointer` supplies physical hit acceptance at down, move, release and hold dispatch using the latest pointer event. It must agree with `resolve(originalElement)` on the element and logical identity. `HoldAction.identity` uses `Object.is`; omission uses the element. Change identity when a retained element represents a different logical control. The control remains inside the owned root, but an explicit document `pointerTarget` can observe coordinate-based regions whose DOM lets presses reach a canvas. Pointer observation does not prevent defaults, stop propagation or change pointer capture. Keep those policies in the caller. When a pointer-release touch tap moves focus and exposes a different target under that contact, the binding protects the restored focus from the matching touch-derived compatibility mousedown default in browsers that expose its provenance. Other inputs keep their normal defaults.

`HoldAction.ownAriaDisabled: "refusal-feedback"` explicitly permits the original callback or hold override through that control's own ARIA refusal state. Use it only when the callback explains refusal without accepting the blocked action. Omission retains own-ARIA blocking. Both the current logical descriptor and, in pointer-release mode, the physical descriptor must permit it at dispatch. Native disabled state, inert, any disabled ancestor and a disabled binding root remain hard blocks. Availability, identity, modal/readiness guards, cancellation and release-click suppression still apply. The attribute is never removed or rewritten.

The returned callable `HoldActionsBinding` disposes listeners. Its `cancel()` instead clears the current logical gesture, timer and pressed visual immediately while retaining only matching release suppression. Wire caller modal and readiness invalidation to `cancel`, rather than disposing and rebinding a persistent root. Captured/current guards and availability remain required. A notification source must actually report each invalidation; an `accepts` callback alone is not a subscription. Disposal ends interception, including suppression of subsequent clicks.

Short releases and holds consume their corresponding native compatibility click inside the owned root. A pointer-specific witness follows that owned gesture across native event tasks and ends on a new pointer down, the matching pointer click, blur or disposal; pointer-release mode also clears it on page hiding. The pointerless MouseEvent fallback remains confined to the release task. Tie disposal to the owned root lifetime; disposal ends interception. Detail-zero keyboard/accessibility clicks and unrelated controls or pointers retain their existing handlers. No click is synthesized. Coordinate routing preserves underlying continuous input; it does not claim that the underlying game must accept the action.

`LoadingFailureContext` and `CrashScreenOptions` optionally accept `bindHoldAction(action)`, where `action` supplies the original `element`, `available` and `activate` closure. The caller binds its guard and rule and returns a disposer. Retry retains its busy, state and generation checks and disposes the binding with its view. Crash Reload and developer Copy use their existing semantic callbacks and page lifetime; native disclosure and text selection remain native. Omission preserves existing factory behaviour.

## Action font synthesis in 0.51.0

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailureActionTextStyle`, extending the existing text style with optional `synthesis: "none" | "weight"` for `presentation.text.action` only. Explicit values set hardened `font-synthesis` on Retry. Omission preserves inheritance; replacing an explicit value with omission through `setPresentation` removes the inline synthesis policy. Title/body, unconfigured fallback and legacy layout policies remain unchanged.

The caller still supplies `weight`. Qualify weight and synthesis together on the actual platform: enabling synthesis alone does not guarantee heavier glyphs or a match to another control's font. This option preserves the fixed system font stack, caller CSS size, geometry, palette and independence from game fonts or downloads.

## Configured text paint in 0.50.1

Configured headings and body text use transparent backgrounds over the caller's panel colour. Unconfigured and legacy-layout fallback backgrounds remain unchanged. Public declarations, geometry, typography and input behaviour are unchanged.

## Configured failure presentation in 0.50.0

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailurePresentation` and `LoadingFailureTextStyle`. Pass optional `presentation` to `mountLoadingFailure` to configure the existing hardened fallback. Omission retains the previous native fallback and optional `layout` behaviour. `layout` and `presentation` are mutually exclusive. Invalid configurations fail before DOM mutation; configurations are captured rather than retaining caller objects. Set `presentation.action.widthPx: "content"` with `LoadingFailurePresentation<"content">` to fit the Retry label, horizontal padding and borders within the panel. Height and centering follow the configured presentation. The default type parameter remains `number` for numeric callers.

All geometry is explicit CSS pixels. The `panel` group supplies `maxWidthPx`, `safeInsetPx`, top/horizontal/bottom padding, title-to-body and body-to-action gaps, border width, bottom lip height and shadow offset. The maximum width is configurable rather than a renderer constant. Mount inside a caller-owned frame with definite dimensions; that frame owns placement and centring. The panel bounds its width and height against that frame and scrolls overflowing content. It neither discovers a game frame nor controls the viewport or loading bar.

The `text` group supplies title, body and action styles, each with `sizePx`, `weight` and unitless `lineHeight`. Configured text uses `system-ui, sans-serif` independently of game scale and needs no font or artwork download. The `action` group supplies explicit `widthPx` and `heightPx`, horizontal/bottom padding, border width and highlight/shade heights. Callers convert their normal logical button size through their own fit exactly once; the renderer adds no CSS height floor, device-pixel multiplier or font shrinking. The `palette` group supplies explicit hex colours for the panel, text, action, action text, border, lip, shadow, highlight and shade. Optional `panel.highlightHeightPx` with `palette.panelHighlight` draws the panel's bevel row: an inset highlight of that height under the top border, painted above the lip and shadow. Give both or neither; omitting both keeps the panel's shadow unchanged. Configured properties remain hardened against inherited page styles.

A mount with a required `presentation` returns a configured view with `setPresentation(next)`. Use it from the existing fit/resize subscription to update CSS dimensions without replacing the button or resetting retry, state, focus or held-key tracking. Validation completes before updates are applied. Dispose the view and caller subscription with their existing lifecycle. Presentation never controls retry classification, required-resource priority, activation, saves, mute or modal policy.

Explicit button dimensions and fixed text can conflict in very short frames. Scrolling does not prove that a label fits its button. Callers must qualify their supported frames and report an unavailable fit rather than silently changing the requested font or dimensions. Existing Retry singleflight, keyboard containment, exact messages and native accessibility remain unchanged.

## Retry keyboard containment in 0.49.1

The loading-failure Retry button contains Enter and Space keydown, keypress and keyup propagation while preserving native button activation and accessibility. Matching repeats and release redirected to a neutral document target after disabling or blurring Retry remain contained while focus stays on Retry or neutral. New presses at neutral targets, other controls, focus transfer and window blur end that tracking. Disposal removes its listeners.

This prevents activation keys from reaching window bubble handlers. Ancestor capture listeners still observe them, and redirected events can reach document or earlier ancestor bubble observers. It does not trap focus, suppress unrelated controls, prevent native defaults, synthesize clicks or change retry singleflight, layout, state or caller policy. No API change is required.

## Additive layout controls in 0.48.0

`runtime/ui/layoutTree` exports `LayoutColumnSizing` and `LayoutColumnTrack`. Only `columns` nodes accept optional `sizing`: `{ mode: "equal" }` allocates equal fractions of the bounded content width; `{ mode: "intrinsic" }` keeps content-sized tracks; `{ mode: "tracks", tracks }` assigns one descriptor per child. Descriptors are `{ kind: "fraction" }`, `{ kind: "intrinsic" }` or `{ kind: "fixed", size }`. Fraction tracks share the space remaining after fixed/intrinsic tracks, gaps and padding. Fixed sizes use the existing logical `--ui-unit` scaling. Use explicit intrinsic/fixed descriptors for divider tracks; the renderer never infers a component role. Omission preserves legacy sizing. Invalid configurations fail before DOM mutation. Actual measurements still determine overflow or unavailable results; track selection does not guarantee fit.

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailureLayout`. Pass optional `layout` with all fields `{ actionAlign: "start" | "center" | "end", gapPx, minActionSizePx, paddingPx }` alongside `onRetry` to `mountLoadingFailure`. Numeric values are finite, nonnegative CSS pixels captured at mount; callers convert game units. The fallback applies those values through its hardened CSSOM styles, keeps the native button label centred, and remains independent of game fonts and art. Minimum dimensions do not guarantee viewport fit. Omission retains native defaults. Shared text, single-flight Retry, stale-event guards and disposal are unchanged.

## Version and interface policy

The `exports` map and the exported declarations define the public interface. Internal imports are relative and acyclic, and there is no root barrel, so a pure import loads no engine.

Modules take data and callbacks only. They never depend on a game's types, control flow or test usage.

Compatible fixes are patch versions and additions are minor versions. Incompatible changes are major versions after 1.0, and minor versions with a migration section below before 1.0. Update the manifest and lockfile together. Documentation-only changes need no version bump.

The kit's own tests define each module's contract. Release consumer proof uses pinned Archie and Chibi revisions and Ada's separate pinned check. Use adoption revisions for incompatible changes. See [Release artifacts and consumer proof](#release-artifacts-and-consumer-proof).

The public `test/phaser/sceneStub` has a frozen shape. Extend it through its `overrides` argument.

## Migration to 0.46.0

`load/phaser/watchLoader` now records and retries standalone `xml` files through the existing `retryMode` and `retryFailures` API. Install the watch before queueing XML so its ADD event captures the original base URL and resolved XHR settings. Resolved keys and URL paths are retained without duplicating the loader prefix or path; current loader settings are restored after queueing and native dispatch. XML queued before the watch remains non-retryable because its original context is unavailable.

XML parsing failures are recorded before native loader completion, independently of network failures and without counting the same file twice in progress. Temporary native bindings are restored on settlement or disposal. The caller still selects required loads; optional automatic retry rounds and multi-file captures remain unchanged. No game font or asset key is defined by the kit.

## Migration to 0.45.0

`watchLoader` accepts optional `retryMode(failure)` returning `"automatic"` or `"manual"`. The default preserves automatic retry rounds. The classifier receives a logical `LoadFailure`: the loader method, resolved key, captured configuration and first failed URL, with an entire captured multi-file load classified together. The caller identifies required UI or other active-view dependencies; the kit contains no required asset list. Automatic scheduling and dispatch exclude manual failures while retaining their records and original multi-file arguments. Optional failures retain their existing timers and round counts.

`watch.retryFailures(select)` explicitly requeues only currently recorded selected failures. Successful loads remain intact. Calls share an active flight and add newly selected logical loads without duplicating those already queued. Manual retries do not consume automatic retry rounds. The promise settles when the loader run completes or the watch is disposed; settlement is not a success result. Recheck the caller's required-resource status before continuing. Use the existing `waitFor(label)` and progress handle for the same loading bar. Keep one watch for its scene lifecycle rather than disposing it to suppress a subset of retries.

`createLoadingAttempts` reruns the supplied callback; it does not clear native ES module maps or reload the document. A browser may retain a failed module record, and module evaluation failures are not repaired by importing that record again. Keep fallible application startup in an explicit attempt-owned function, with cleanup registered before acquiring mutable resources. Same-page recovery requires a genuinely repeatable provider operation. A fresh-document restart is a separate caller-owned lifecycle decision, including launch, activation and save guards.

## Verified JSON body reuse

`build/precachePlugin` accepts optional `verifiedJsonBodies(files)`, selecting explicit URL families from complete final emitted discovery. The URL-array form asserts public, URL-independent UTF-8 JSON with no per-URL response semantics. The plugin parses each body, compares exact final bytes and records each family's full SHA-256, byte size and URLs in the manifest's `verifiedJsonBodies`. Omission selects no families. Family metadata changes the version.

The page installer and the router apply the same response rules (`dom/verifiedJsonSource`). Family requests omit credentials and reject redirects. A network response must be status 200 from the exact requested same-origin URL, with JSON MIME and UTF-8 or no charset. It fails on `clear-site-data`, `content-disposition`, `content-location`, `content-range`, `refresh` or `set-cookie`, a `private` or `no-store` directive, a Vary other than `accept-encoding`, a length that differs from an identity body, an encoding other than identity, gzip, br or deflate, or MIME protection other than `nosniff`. Any other header, such as a CDN's `priority` or `server-timing` or HTTP/1.1 `connection` and `keep-alive`, carries no body semantics and is ignored. A stored entry needs no source URL: its `x-game-kit-sha256` header, set after verification, and a JSON content type suffice, and any other headers it carries must pass the same checks. The router hashes a stored family body in full before it serves it, and refetches it otherwise. Qualify the deployment's response headers before opting in.

### JSON-data response profile

A family may opt into `{ urls, responseProfile: "fetch-json-data-v1" }` instead of the URL array. Use this only for public JSON interpreted as data without dependencies on its response URL, per-URL headers or relative body URLs. The profile also accepts browser-decoded `zstd`, and its metadata changes the version.

The plugin rejects `fetch-json-data-v1` with `updateGroup` or `wholeBuild`. Use the URL-array form with archives only for families that meet its URL-independent response contract. Switch to per-file updates to keep the profile.

The router answers an exact canonical same-origin GET data request (empty destination, nonnavigation mode, no Range or If-Range header) for a profile URL with the verified body and only `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff`. Navigation and every other request context for a profile URL get that URL's own original response from the network, never the body alias. A profile URL with a query or another noncanonical form is refused. This mechanism provides neither parsed-object caching nor a download-time guarantee.

## Migration to 0.44.0

`gameViteConfig` passes one captured `BuildMetadata` as the third `plugins(modules, repoPath, metadata)` argument and defines `__BUILD_ID__` alongside the existing `__COMMIT__`. Pass `metadata.buildId` into `precachePlugin({ buildId, ... })`; do not independently shorten or derive it. `web/build/buildVersion` exports the pure `buildMetadata` and `isBuildId` helpers; `web/build/vite/gitHead` exports `gitBuildMetadata` for custom Vite configuration. With `buildId`, the plugin validates that the captured ID still matches clean Git source and the app define, so development, dirty source, missing Git identity or a mismatching CI commit fails the build. Without it the manifest records `UNKNOWN_BUILD_ID`.

## Migration to 0.43.0

### Required loading failures

`load/loadingAttempts` exports `createLoadingAttempts({ load, onState, onReady? })`. It starts one required-file attempt, coalesces concurrent calls, and retries only after an explicit `retry()` from failed state. `load(attempt)` owns required-file classification and the existing single foreground progress handle; `attempt.isCurrent()` guards stale asynchronous bar updates. Optional placeholders remain caller-owned. Dispose the controller with its loading flow. Register caller-owned abort/partial-instance/listener cleanup with `attempt.onCancel(cleanup)`. Failed or disposed attempts cancel before another retry; success commits ownership to the caller rather than destroying the live game. The pure controller owns no browser AbortController.

For page-lifetime required sets, `createRequiredLoading(initialResources)` observes structural providers with `status()` and failed-only `retry()`. Register a late provider with `observe(resource)` and call `invalidate()` after provider status changes. `subscribe(listener)` reports immediately and returns an unsubscribe function. `wait(ready)` registers a one-shot continuation and returns its unregister function; readiness is rechecked between callbacks, so one callback can add another required set before the next continuation. Ready state is not terminal for this page-lifetime registry. Explicit retry is singleflight, preserves successful providers and waits for the active attempt to settle. A throwing `status()` counts as failed; one that throws while `retry()` starts rejects that retry with its error and ends the attempt. Dispose subscriptions, registry and view with the page lifecycle; provider I/O and successful resources remain caller-owned.

Continue entry through `onReady`, or check `state.kind === "ready"` only after the attempt promise settles: failed attempt promises also settle normally. Keep the existing launch/activation/newer-save guards around the caller's entry path. The mechanism never reads/writes saves, activates workers, reloads or creates a progress bar.

`web/progress/dom/loadingFailure.mountLoadingFailure({ onRetry }, parent)` returns `{ element, update, dispose }`. Wire `update` to the controller's `onState` and `onRetry` to its `retry`. Mount in a visible, non-inert parent outside font/art reveal gates. Native sans-serif and CSS system colours keep the shared alert readable if the game font or UI art fails. The same `LOADING_FAILURE_TEXT` is used by every consumer: title `Loading failed`, body `Some game files could not load. Try again.`, button `Retry`. Raw errors are not rendered. Success continues once; another required failure returns the same alert. Dispose the view and controller together; caller I/O already in flight is not cancelled by disposal.

## Migration to 0.41.0

Additive typed composition through `ui/layoutTree`, `web/ui/dom/layoutTree` and its opt-in `layoutTree.css`. Supply actual production component factories and use the same tree, ports, fonts and CSS for runtime and mocks. Stable keys retain DOM identity and focus across updates. Physical measurements are caller-owned; absent or incomplete measurements report `unavailable`, never fit. The renderer reports overflow without shrinking, clipping or adding scrolling. Game navigation, labels, actions and approval remain caller-owned.

## Migration to 0.40.0

Additive shared controls. `ui/buttonLayout` and `web/ui/dom/buttonLayout` share caller-authored button geometry between Art mocks and runtime controls. Import `web/ui/dom/controls.css` explicitly. Define one named token record for both renderers; Art tooling remains structural and dependency-cycle-free. Existing `ui.css` spacing and defaults are unchanged. `ui/controlPresentation` and `web/ui/dom/controlPresentation` provide availability guards, one inherited page/modal divider and a decorative disclosure mark; import their `controlPresentation.css` explicitly.

Use external top alignment for Buy/Details beside multiline copy, explicit centre alignment for compact quantity rows, and a common height and authored font line box/baseline for footer controls. Always centre the single foreground label inside its button face. Games retain fonts, palettes, faces, labels and navigation content.

## Migration to 0.39.0

- `save/versionedSave`: any finite numeric header above `format.version` returns `"newer"` before integer validation, migration or decoding, including higher fractional and unsafe integer values. Lower malformed headers remain `"corrupt"`. The fresh save returned for `"newer"` is only a placeholder: keep play blocked and preserve the stored save until a compatible version can load it.
- `save/saveStore`: `SaveStore` gains `blockWrites(reason: string): void`; add it to store test doubles. The first reason permanently fences later save and corrupt-backup writes for that store instance, including after a pending read or an encoder callback. Later reads remain available and never rearm writes; a fenced `save()` returns `"unavailable"`. Use this when another store or a session guard requires writes to stop. A backend write already entered may finish and report its actual result, including `"saved"`; the fence does not cancel or roll back that write.

## Migration to 0.36.0

Additive. `web/ui/dom/focusModality` is new, and `web/ui/dom/modalLayer` and `web/crash/dom/crashScreen` move the focus through its `focusTarget`, so script focus on a touch screen no longer shows a focus ring while keyboard players keep theirs. Optionally call `trackInputModality(document)` at boot and replace each of the game's own screen-open `.focus()` calls with `focusTarget(element)`.

## Migration to 0.35.0

- `view/phaser/tilemapCull` is new. Optionally replace a local tilemap cull with `cullToCameraView(layer)`, which culls an orthogonal layer to the area the camera shows for its own origin.

## Migration to 0.32.0

Additive. `load/phaser/watchLoader` retries multi-file loads, such as bitmap fonts and Aseprite sheets, as a whole in the same silent rounds as single files, and gives each of their files the loader's timeout. `MULTI_FILE_METHODS` lists the loader methods it covers, `MultiFileMethod` names one, and `RetryableType` adds them. Delete any local retry of fonts or sheets, and queue multi-file loads through the loader's methods after creating the watch.

## Migration to 0.31.0

Each game changes:

- `ui/hitAreas` adds `HIT_RULE`, the shared press-area rule (`minTarget` 48). Replace a game-local rule or fixed press size with it.
- Loading: pass `load/loaderConfig`'s `LOADER_CONFIG` as the Phaser game config's `loader`. In every scene that loads, call `load/phaser/watchLoader`'s `watchLoader({ console, progress: foreground, timer: window }, this)` in `init` or `preload` each time the scene starts, and mark each load the player waits for with `waitFor(label)` (boot, entering a level or area) instead of reporting Phaser's `progress` fraction or a byte share to the bar. Drop the game's own `loaderror` logging; the watch logs and retries failed files.
- Loading bar: make the foreground loads and a forced update two progress states, and have the bar follow `createLayeredProgress(window, timing, { background, foreground })` (`progressState`) instead of either state. A bar that existed only while something loaded stays mounted and hidden while idle.
- Delete every local copy these replace: loader timeout and retry settings, loader trackers, failed-file logging and retry, and foreground and background bar schedulers.

## Migration to 0.29.0

Additive. `ProgressBarStyle` takes optional `frameAlpha` and `trackAlpha` in [0, 1], default 1, for a translucent or invisible frame and track behind opaque fills; `checkProgressBarStyle` throws a `RangeError` outside that range. A finished measured bar can fade out after its full hold: pass `fadeMs` as `createProgressDisplay(fullMs, fadeMs)` in Phaser or in the DOM bar's `timing`, which writes `--progress-bar-fade`. Existing calls are unchanged. Replace a game-local fade or alpha on the loading bar with these, for example `{ border: 1, fills: [0xead4aa], frame: 0, frameAlpha: 0, track: 0x181425, trackAlpha: 0.6 }` with `{ cycleMs, fadeMs: 150, fullMs: 250, segment: 0.3 }`. Pre-script markup sets the same `--progress-bar-fade` on the `.progress-bar` and paints its own translucent colours.

## Migration to 0.28.0

Additive. A DOM progress bar created with `timing` lands its travelling segment on whole pixels of the frame's units, as the Phaser bar does: the script writes `--progress-bar-segment-width` and `--progress-bar-steps` (`progressBarPixelProperties`), and `progressBar.css` steps the travel one pixel at a time. Remove game rules that round the segment or step its travel, such as a `steps()` timing on `.progress-bar-band > *` and the step count property and segment rounding that feed it, and pass the motion's own `segment`. Pre-script markup keeps its continuous travel unless its static CSS sets the same two properties on the `.progress-bar` from `progressBarPixelProperties(style, motion, frame)`.

## Migration to 0.27.0

Additive. `ui/spacing` adds `STACK_BUTTON_GAP` (8 base px) between standard buttons stacked vertically, and `ui.css` defines `--ui-stack-button-gap` on `.ui-layer`. Small buttons take `SMALL_BUTTON_GAP` in any direction, stacks included. Replace a game-local stack gap with the constant, or with `var(--ui-stack-button-gap)` inside `.ui-layer`.

## Migration to 0.26.0

- `ui/spacing` (new): `BUTTON_GAP` (16 base px) between standard buttons side by side and `SMALL_BUTTON_GAP` (24) between small buttons, with `--ui-button-gap` and `--ui-small-button-gap` on `.ui-layer`. Replace each game-local gap between buttons with the constants, or with the properties inside `.ui-layer`; they are undefined outside it.

## Migration to 0.25.0

Loading bars follow one rule: nothing while idle, a measured bar that fills to full and then disappears, and an indeterminate segment that travels left to right until the work finishes. The static centred segment is removed. Each game changes:

- `progress`: `progressBarLayout` takes a `number`; a nonfinite share lays out empty. A build-time layout of `undefined`, such as a pre-script strip, becomes the DOM bar's markup with its bands at `progressBarLayout(style, frame, 1).fills`, animated by `progressBar.css`. Match the script's markup: the track is the bar's first child, then one `.progress-bar-band` per fill, each holding one segment. The script sets `overflow: hidden` on each band, so pre-script CSS must clip the bands itself.
- `progress/phaser/drawProgressBar`: `drawProgressBar` takes a `number` and stays for measured meters. A loading bar keeps a `createProgressDisplay(fullMs)` that its progress state reports to (`state.subscribe(display.report)`), and each frame clears its graphics and calls `drawProgressDisplay(graphics, style, motion, frame, display.at(time))` with the scene clock and a `ProgressMotion`.
- `web/progress/dom/progressBar`: import `@andornaut/game-kit/runtime/web/progress/dom/progressBar.css`; without it a pending bar draws its segment across the whole track. Existing `createDomProgressBar(parent, style, frame)` and `update(value)` calls are unchanged and travel while pending. Pass `timing` to set the motion and hold, and subscribe `report` in place of toggling visibility to hide the bar while idle and fill it on a measured finish. The fill shows only when the last active report was measured: reporting `undefined` before the finish hides the bar at once. To fill a measured load and then wait on work of unknown length, finish the measured operation at 1 and begin a separate one for the rest.

## Migration to 0.21.0

The install offer shows in every browser until the game is installed: the browser's install prompt where it holds one, otherwise that browser's own install steps. Each game changes:

- `web/pwa/installState`: `MenuInstallBrowser` and `menuInstallBrowser` are replaced by `InstallStepsKind` and `installStepsKind(userAgent, maxTouchPoints)`, and `InstallFacts` drops `menuBrowser`. `InstallState` is `installed`, `prompt` or `steps`; `unsupported` and `menuSteps` are removed, and `offersInstall` is true in every state but `installed`.
- `web/pwa/dom/installFlow`: `InstallFlow.menuBrowser` is renamed `stepsKind` and is always set. `install()` returns `accepted`, `dismissed` or `steps`; `menuSteps` and `unavailable` are removed, and `steps` (no prompt held, or it failed to show) means show the steps for `stepsKind`.
- `web/pwa/dom/installButton`: each steps dialog section is marked `data-steps="<kind>"` instead of `data-browser`.
- Supply steps for all eight kinds, typed `Record<InstallStepsKind, ...>` so none is missed: `chromiumAndroid`, `chromiumDesktop`, `firefoxAndroid`, `firefoxDesktop`, `ios`, `other`, `safariMac` and `samsungInternet`. A dialog without a kind's section shows its `other` section.

## Migration to 0.19.0

- `testing/phaser/sceneStub`: an override member that is an object literal now merges into the stub's member one level deep instead of replacing it, so `{ scene: { get } }` keeps the other `scene` spies. A class instance, function, array or emitter still replaces the member. To replace a whole member with a literal, assign it after construction: `Object.assign(stub, { scene: { get } })`. The literal is copied, not shared: a test that changes a value later, such as advancing `time.now`, changes the stub's member (`const { time } = stub`), not its own literal.
- `testing/phaser/sceneStub`: `add` holds game object factories instead of starting empty, and `textures.list` holds `StubTexture` values, which tests seed without a cast.
- `terrain/movementMap`: equal-seconds arrivals over one edge now resolve by the documented rule (the arrival generated first wins) instead of by heap layout, so a path may differ from 0.18.0 only where two routes take exactly the same time.

## Modules and environments

The inventory uses implementation paths relative to `src/`, and tests sit beside their modules. Use the canonical namespace mapping above for imports. Only explicit `package.json` exports are public; internal helpers and fixtures remain private.

| Modules                                                                                                                                           | Environment              | Responsibility                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `achievements`, `achievements/preview`                                                                                                            | Pure                     | Badge judging, tier order, awarding, the earned record and unlock notices                                  |
| `ai/utility`                                                                                                                                      | Pure                     | Scored action choice with hysteresis and a seeded tie-break                                                |
| `arrays`, `assertNever`, `lines`, `mapLimit`, `maps`, `numbers`, `opaqueBounds`, `random`, `records`, `rect`, `rgba`, `units`                     | Pure                     | Collections, bounded mapping, text fields, geometry, randomness, pixels and units                          |
| `art/aseprite`, `art/rgbaImageTypes`                                                                                                              | Pure                     | Animation specifications and the RGBA image type                                                           |
| `clock/fixedStep`, `clock/frameCap`, `clock/timer`                                                                                                | Pure                     | Fixed-step timing, frame-cap decisions and the injected timer                                              |
| `input/*` except `input/phaser/*`, `modalLayout`                                                                                                  | Pure                     | Press, hold, scroll, gesture and modal state                                                               |
| `load/fileShare`, `load/loaderConfig`, `load/loadingAttempts`                                                                                     | Pure                     | Loader timeout and retry policy, and the measured share of a load run                                      |
| `motion`                                                                                                                                          | Pure                     | Immutable motion segments and easing                                                                       |
| `progress`, `progressState`                                                                                                                       | Pure                     | Bar geometry, operation state and the layered bar                                                          |
| `save/*`                                                                                                                                          | Pure                     | Storage contract, memory implementation, versioning and save coordination                                  |
| `terrain/crumbling`, `terrain/traversal`                                                                                                          | Pure                     | Fixed-tick support lifecycle, bounded search and shared collision stepping                                 |
| `terrain/airMap`                                                                                                                                  | Pure                     | Flyer clear-cell graph, perch links and axis-change-penalty search                                         |
| `terrain/movementMap`                                                                                                                             | Pure                     | Baked ground spans, kernel-witnessed edges and masked shortest-time queries                                |
| `testing/storageFixture`, `testing/dom/failingLocalStorage`, `testing/phaser/sceneStub`                                                           | Pure, DOM, Phaser types  | Failing save and Web Storage, and a Scene stand-in with injected spies                                     |
| `text/*` except `text/phaser/*`                                                                                                                   | Pure                     | Bitmap font metrics, fixed-size wrapping, overflow and pixel atlas geometry                                |
| `ui/actions/actionGroup`, `ui/uiTheme`                                                                                                            | Pure                     | Action group fitting, press outsets and projection; theme colour slots and text roles                      |
| `ui/actions/buttonLayout`, `ui/controlPresentation`                                                                                               | Pure                     | Caller-token button group sizing, contained placement and current-navigation filtering                     |
| `ui/focusKeys`, `ui/actions/hitAreas`, `ui/actions/spacing`                                                                                       | Pure                     | Focus keys and steps, press areas by nearest control, and the button gaps                                  |
| `ui/layout/modalFrame`                                                                                                                            | Pure                     | Modal frame and page geometry: width families, header, title clearance, scroll body, footer, close         |
| `ui/layout/formRow`, `ui/actions/pager`, `ui/actions/hudDisc`                                                                                     | Pure                     | Form row layout properties, pager arrangement and state, HUD disc icon placement                           |
| `ui/layout/slider`                                                                                                                                | Pure                     | Slider steps, key steps, pointer steps and whole-unit track and thumb geometry                             |
| `view/fitCheck`, `view/modalDim`, `view/pagePoint`, `view/renderScale`, `view/settleFit`                                                          | Pure                     | Fit decisions, dimming, coordinate mapping, device render scale and settling                               |
| `web/buildLabel`                                                                                                                                  | Pure                     | Build labels                                                                                               |
| `web/crash/crashModel`                                                                                                                            | Pure                     | Crash classification and presentation data                                                                 |
| `web/pwa/*` except `web/pwa/archive/*` and `web/pwa/dom/*`                                                                                        | Pure                     | App window, install, back, build contract and records, launch and router rules, cache policy and storage   |
| `web/pwa/archive/*`                                                                                                                               | Pure and `TextEncoder`   | Build archive index and update group recipe codecs                                                         |
| `web/save/sessionStore`, `web/save/storage`                                                                                                       | Pure                     | Never-throwing session store and Web Storage save adapters                                                 |
| `web/view/frameTurn` and its `frameTurn*Game.css` stylesheets                                                                                     | Pure, CSS                | Page frame turn policy and the turned-frame stylesheets                                                    |
| `clock/phaser/*`, `input/phaser/*`, `load/phaser/*`, `progress/phaser/*`, `text/phaser/*`, `view/phaser/*`                                        | Phaser, browser renderer | Frame caps, input guards, load runs, progress, fonts, snapshots, backdrops, texture filters, tile culls    |
| `web/view/phaser/followFrameTurn`                                                                                                                 | Phaser, browser renderer | Phaser fitting and pointer mapping through the page frame turn                                             |
| `web/crash/dom/crashScreen`, `web/crash/dom/crash.css`                                                                                            | Browser DOM              | Crash screen in the game's words and colours; Reload starts a new launch                                   |
| `web/input/dom/holdActions`                                                                                                                       | Browser DOM              | Opt-in delegated hold dispatch through caller actions and modal guards                                     |
| `web/input/dom/pagePresses`                                                                                                                       | Browser DOM              | Page pointer presses followed from pointerdown until they lift or cancel                                   |
| `web/progress/dom/loadingFailure`                                                                                                                 | Browser DOM              | Readable shared required-loading error and explicit Retry action                                           |
| `web/progress/dom/progressBar` and its `progressBar.css` stylesheet                                                                               | Browser DOM, CSS         | Progress bar using the shared geometry, before Phaser loads                                                |
| `web/pwa/dom/`                                                                                                                                    | Browser DOM              | Visibility, wake lock, audio, back and exit                                                                |
| `web/pwa/dom/launch/`, `web/pwa/dom/routing/`                                                                                                     | Browser DOM              | Install prompts, page launch and updates, router worker and capability probes                              |
| `web/pwa/dom/storage/`, `web/pwa/dom/transfer/`                                                                                                   | Browser DOM              | Build stores, verified downloads and archive member readers                                                |
| `web/save/dom/localSaveStorage`, `web/save/dom/pageSessionStore`                                                                                  | Browser DOM              | The page's `localStorage` and `sessionStorage`                                                             |
| `web/ui/dom/` and `ui.css`, with optional `uiTheme.css`                                                                                           | Browser DOM, CSS         | Units, focus, presses, theme, frames and decoded art                                                       |
| `web/ui/dom/controls/` and its opt-in stylesheets                                                                                                 | Browser DOM, CSS         | Buttons and skins, action groups, form rows, HUD disc, pager and slider                                    |
| `web/ui/dom/layout/` and its opt-in stylesheets                                                                                                   | Browser DOM, CSS         | Declarative layouts, availability and navigation decoration                                                |
| `web/ui/dom/dialogs/modalFrame` and its opt-in `modalFrame.css` stylesheet                                                                        | Browser DOM, CSS         | HTML modal frame on the modal layer, or a non-modal page: backdrop, dialog card, skin, body, footer, close |
| `web/view/dom/watchFrameTurn`                                                                                                                     | Browser DOM              | Marks the frame turn on `<html>` and requests the orientation lock                                         |
| `build/buildVersion`, `build/phaserBuild`                                                                                                         | Pure                     | Commit selection, reduced Phaser entries and feature flags                                                 |
| `build/securityHeaders`                                                                                                                           | Pure                     | Content-Security-Policy rules and Cloudflare `_headers` rendering                                          |
| `build/buildManifest`, `build/precacheList`, `build/hashedIcons`, `build/rgbaImage`                                                               | Pure                     | Build manifest and pointer, precache lists, icon names and RGBA image processing                           |
| `build/vite/securityHeadersPlugin`                                                                                                                | Vite, Node build time    | Writes `_headers` with per-page inline hashes                                                              |
| `build/vite/buildInfo`, `build/vite/gameConfig`                                                                                                   | Vite, Node build time    | Build constant declarations and a game's whole Vite and Vitest config                                      |
| `build/vite/contentHash`, `build/vite/gitHead`                                                                                                    | Vite, Node build time    | Vite-compatible content hashes and the repository HEAD                                                     |
| `build/vite/phaserBuild/phaserBuildPlugin`, `build/vite/phaserBuild/phaserSource`, `build/vite/phaserBuild/phaserUses`                            | Vite, Node build time    | Reduced Phaser bundles from source, and a static check of a game's Phaser use                              |
| `build/vite/hashedIconsPlugin`, `build/vite/precache/precachePlugin`, `build/vite/precache/groupArchive`, `build/vite/precache/originMemberPacks` | Vite, Node build time    | Content-hashed icon names, the router worker, build manifest and pointer, and the group archive encoder    |

A module's directory names its environment, and its `tsconfig.<environment>.json` lists it explicitly:

| Directory         | Project                | Globals and imports           |
| ----------------- | ---------------------- | ----------------------------- |
| none of the below | `tsconfig.pure.json`   | ES2022 only                   |
| `phaser/`         | `tsconfig.phaser.json` | ES2022, DOM and Phaser        |
| `dom/`            | `tsconfig.dom.json`    | ES2022 and DOM, no Phaser     |
| `vite/`           | `tsconfig.vite.json`   | ES2022, Node and Vite, no DOM |

Each compilation rejects the other environments' ambient globals, and ESLint rejects imports across them: pure modules import no environment directory, `dom/` imports no Phaser or `vite/`, `vite/` imports no Phaser or `dom/`, and nothing outside `vite/` imports Vite. `web/<area>/` holds website runtime infrastructure in the same layout: pure policy such as cache policy and build records at the top and browser bindings in `dom/`. Build-time code lives in `build/`, pure at its top and Node and Vite in `build/vite/`. Canonical public paths classify consumer use, for example `@andornaut/game-kit/build/securityHeadersPlugin` points to `src/build/vite/securityHeadersPlugin.ts`. Each module sits in a source band, which [Packaging](docs/design/packaging.md#source-bands) lists. The combined test/config project has the development types it needs.

## Integration contracts

- **Device resolution:** `view/renderScale`'s `renderScale(max, devicePixelRatio)` is the WebGL backing's device pixels per CSS pixel, r = min(DPR, max) (`MAX_RENDER_SCALE` is 2), or 1 for a non-finite or non-positive ratio. `renderFit(base, r, css)` gives the device-pixel `backing` (round(css x r)), the CSS `fit` per logical pixel (min of the axis ratios), `r`, the `zoom` (r x fit, fractional) and the device-pixel `view` (round(base x zoom)). `densityTexels(zoom, logical)` is max(1, round(logical x zoom)), with no cap of its own. `followFrameTurn`'s `{ deviceResolution: { max } }` option fits at installation and each refit with Scale.NONE, `resize(round(parent CSS size x r))` and `setZoom(1 / r)`, so `gameSize`, pointers and cameras are in device pixels; it sets `image-rendering: pixelated` on the canvas for the browser's upscale above `max`, and refits on a DPR change through a re-armed `matchMedia("(resolution: <dpr>dppx)")` listener that the disposer removes. Without the option, fitting is unchanged. `view/phaser/textureFilter`'s `setTextureFilters(textures, filters)` sets each key's `linear` or `nearest` filter on every source it draws from, and throws before changing any filter on a missing key or on keys sharing a source (an atlas page) with different modes. Games own the base size, camera placement and each texture's mode.
- **HTML UI:** menus, HUD, cards and text are HTML over the canvas, in `web/ui/dom/`. Script writes only custom properties (`style.setProperty`) and the attributes it needs (`inert`, `aria-*`, `hidden`, `data-*`, SVG geometry), never a `<style>` or inline style text, so a CSP of `style-src 'self'` holds. The rules are in `web/ui/dom/ui.css`, which the game imports. Games supply every string, colour, asset, layout value and timing except the button gaps, and own each view and controller.
  - `web/ui/dom/viewUnits`: `createViewUnits(edges, layer)` returns `update(fit)`, which takes `{ unit, view }` (CSS px per base pixel, and the play view's rect in the layer in CSS px), writes `--ui-unit`, `--ui-view-left`, `--ui-view-top`, `--ui-view-width`, `--ui-view-height` and each nine-slice edge's `--ui-slice-<edge>` (whole CSS px, `max(1, round(edge x unit))`) where they changed, and returns whether any did; it ignores a non-positive or non-finite unit. Edges are whole base px. `units(n)`, `fromEdge(property, offset?)` (an offset from an edge a unitless base-px property holds) and `slice(edge)` give CSS lengths in base px; `readUnit(element)` is the unit in effect there, 1 before it is set; `viewProperties(edges, fit)` and `sliceProperty(edge)` name what the bridge writes. `ui.css` places `.ui-view` in `.ui-layer` from these.
  - `web/ui/dom/layoutProperties`: `writeLayoutProperties(values, element)` writes each `--name` value (numbers unitless) through CSSOM where it differs, returns whether any changed, and throws before writing on a name that is not a custom property or a non-finite number.
  - `web/ui/dom/modalLayer`: `createModalLayer(root)` is the one modal layer over `root`, whose element children are the game's UI layers; `dispose()` removes its listeners and inert marks. `open(options, dialog)` sets `aria-modal="true"` on the dialog (and `tabindex="-1"` where it has none), makes every other child of `root` `inert` (leaving ones the game made inert), focuses `options.focus` or the dialog, and returns `close`, which restores the layers and focuses the element focused before open, or `options.restore()`, or the card below. `options.live` names elements under `root`, outside the dialog's layer, that stay live while the card is on top: instead of their whole layer, the siblings along the path from `root` to each are made `inert`. A live element under an element the game made inert stays inert. The marks follow the top card, so a card opened over this one without `live` makes them inert again. Only the top card takes keys, through `ui/focusKeys`: Tab and the arrows step the focus through `focusTargets(dialog)` (focusable, with a nonnegative tab index and outside `hidden`, `inert` and `data-ui-pending` subtrees), then through each live element's targets (the element itself first where it is focusable) in `live` order, wrapping; Enter and Space call `click()` on the focused control, in the card or a live element, once per press; Escape and P call `options.close` wherever the focus is. Handled keys are prevented and stopped at the document, so `window` listeners such as Phaser's keyboard never see them. Focus that leaves the top card and its live elements returns to the card. Every focus move goes through `web/ui/dom/focusModality`'s `focusTarget`, and the layer tracks its document's input modality from creation without disposing it. `back()` calls the top card's `close` and returns whether a card was open, for the game's back handler. It does not use `<dialog>.showModal()` or popover, which render outside a turned page frame.
  - `web/ui/dom/focusModality`: script focus shows the focus ring only to keyboard players. `trackInputModality(document)` records the document's last input modality, `keyboard` on `keydown` and `pointer` on `pointerdown` (on `touchstart` where the document's window has no `PointerEvent`), in passive capture-phase listeners, so a listener that stops the event does not hide it. It returns a disposer that removes the listeners and forgets the modality; tracking a document already tracked adds nothing and returns the same disposer. `inputModality(document)` is the last modality, or `undefined` before any input or while untracked. `focusTarget(element)` tracks `element.ownerDocument` if it is not tracked yet, then calls `focus()` with no options after keyboard input, so the ring shows and the element scrolls into view, and `focus({ focusVisible: false, preventScroll: true })` before any key or after a later press. A browser that ignores `focusVisible` applies its own `:focus-visible` heuristic, under which a script's focus before any pointer input can show the ring. `web/crash/dom/crashScreen` tracks the modality from `installCrashScreen` and focuses Reload through `focusTarget`.
  - `web/input/dom/holdActions`: `bindHoldActions({ guard, resolve }, root)` returns an idempotent disposer. `resolve(target)` returns null for excluded or continuous controls, otherwise `{ element, rule: { holdMs, slopPx }, available, activate, hold? }`; it must also resolve the control element itself. A hold invokes the current `hold` override or `activate` closure once, while native tap, keyboard and accessibility click handlers remain caller-owned. No `click()` is synthesized. Rules use milliseconds and client pixels; duration is finite and nonnegative, slop is nonnegative and may be infinite. The first primary pointer captures the supplied `PressGuard`, rechecked at dispatch together with the current action, availability, connection, native disabled and inherited aria-disabled/inert state. Drag, leaving, cancellation, lost capture before dispatch and window blur cancel pending holds. Register before root capture-click actions; the binder does not install `guardClicks`. After a held pointer releases, only a nonzero-detail click on the original control with the same pointer identity is suppressed. A legacy MouseEvent uses that same-control pointerup witness; both witnesses expire at the next timer task or any new pointerdown. Other controls, other pointers and detail-zero clicks are unaffected. Callback-driven control removal is supported; no interception is promised after disposal or outside the root. Dispose with the root lifecycle. Eligibility, thresholds, action registry, explicit overrides and modal ownership stay with the caller.
  - `web/ui/dom/domPress`: `guardClicks(guard, root)` stops, in the capture phase, every click under `root` that the guard refuses. A pointer click completes only the press of the followed pointer (`input/onePress`, lifts read on the document) that captured `guard.gate` (a `modalInput` scope or gate) on its pointerdown and still holds; a click with no pointer (`detail` 0: Enter, Space or `click()`) needs `gate.accepts()`. The optional `tapGuard: { guardMs, drawnMs }` refuses presses until `guardMs` after `drawnMs()`, on the event timestamp clock. `listenOutsideTaps(guard, tapMaxDistance, onTap, backdrop)` calls `onTap` for a followed press that lands and lifts on `backdrop` itself, never travels past `tapMaxDistance` base px (at `readUnit(backdrop)`), and whose capture holds. A press on an element over `backdrop`, such as a live element stacked above it or one inside it, is not an outside tap; an `inert` element takes no presses, so a press over one reaches what lies beneath it. Both return a disposer. Same-target release is the browser's click; dip timing (`input/targetPress`) stays with the caller.
  - `web/ui/dom/imageReady`: CSS requests `url()` and `background-image` art only at its first paint, so `createImageCache(document)` requests it ahead. `retain(urls)` creates an `<img>` per URL not yet retained, sets its `src`, calls `decode()` and keeps the element for the cache's life, so the decoded image stays in memory for the paint; URLs are deduplicated as given, so each must be the URL the CSS resolves to. `decoded(urls)` retains any URL not yet retained and resolves once every one has decoded or failed; it never rejects. `revealWhenDecoded(cache, urls, layer)` sets `data-ui-pending` on `layer` at once and removes it once `cache.decoded(urls)` settles. `urls` is a list or a promise of one; for a promise, the reveal waits for it to resolve and then for its URLs to settle, and a rejected promise counts as settled, so the layer shows, and returns `{ cancel, revealed }`: `revealed` resolves `true` when the layer is shown that way, and `false` when `cancel()` removed the attribute first or a later reveal on the same layer superseded it (the later one keeps the attribute). `cancel()` after `revealed` settles does nothing. There is no timeout: a promise or request that never settles keeps the layer hidden indefinitely, so the game keeps a fallback view (the canvas or the previous view) drawing until the reveal. `ui.css` gives `[data-ui-pending]` and its descendants `visibility: hidden`, which keeps the layout and takes no presses or focus.
  - `web/ui/dom/sheetFrames`: `cutFrame(document, source, rect)` draws `rect` of an already loaded image source onto a canvas and resolves to its PNG `blob:` URL, which the caller revokes; it rejects without a 2D canvas or encoder. `setNineSlice(name, { slice, url }, element)` sets `--<name>-image` (`url("...")`) and `--<name>-slice` (top right bottom left, frame px). `.ui-frame` draws `--ui-frame-image` with `--ui-frame-slice` and `fill` at border width `--ui-frame-width`, pixelated; the game points these at a frame's properties and a `slice()` edge.
  - `web/ui/dom/buttonSkin`: `createButtonSkin(document, { manifestUrl, sheets, tags })` builds button faces from art-kit sprite sheets once per skin, so the game creates one skin during boot and applies it to every root. It requests at once, with the page's `fetch`, the art-kit sprite manifest at `manifestUrl` (resolved against `document.baseURI`) and, for each key in `sheets` the manifest lists, the sprite's Aseprite hash JSON and PNG (each resolved against the manifest's URL), then cuts with `cutFrame` the first frame each name in `tags` plays (`art/aseprite` `sheetTags` order). `frames` resolves to each cut frame's `blob:` URL keyed by its property, `buttonSkinProperty(sheet, tag)` (`--<sheet>-<tag>`). `apply(root)` sets each property to `url("blob:...")` through `style.setProperty` and resolves to the URLs it set; every root reuses the same cut URLs. The game's CSP `img-src` must allow `blob:`. Neither rejects: a sheet the manifest lacks, a tag the sheet lacks, and a failed fetch, decode, JSON shape or cut leave those properties unset, so the game's CSS fallback stays. A failure is not requested again for that skin; a new skin requests everything again. The URLs it sets last for the page and are never revoked; a failed cut revokes the URLs its sheet already cut. To hold a layer until its faces and other art have decoded, call `revealWhenDecoded(cache, skin.apply(root).then((urls) => [...urls, ...art]), layer)` from `imageReady`.
  - `web/ui/dom/vectorChrome`: `createChromeSvg(document, frame, layers)` returns an `aria-hidden`, unfocusable SVG with `viewBox` `0 0 width height` and one shape per `ChromeLayer`, painted in order: `disc` (filled circle), `ring` (circle stroked from `inner` to `outer`), `stroke` (round-capped, round-joined path) and `rect`, each with a `0xrrggbb` colour. CSS sizes the element.
  - `web/ui/dom/refusalCue`: `refuse(cue, reducedMotion, element)` plays `{ shake, shakeMs?, shakeShape?, stepMs, steps }` on the control for `steps x stepMs` and returns a stop function, restarting a cue already playing there. `refusing(element)` says whether a cue plays there and `stopRefusal(element)` stops it. The flash sets `data-ui-refusal-red` on the even steps of `stepMs`, from the first. The shake strokes every `shakeMs` (default `stepMs`) for the whole cue, by `shake` base px: `shakeShape` `"alternate"` (the default) sets `data-ui-refusal-shake` to `"left"` then `"right"`, each held, and `"yoyo"` to `"out"` then `"back"`, a linear glide to `shake` px right and back to rest over each stroke. A negative `shake` mirrors either shape. With `reducedMotion` it holds `data-ui-refusal-red` for `steps x stepMs` with no shake. It sets `--ui-refusal-shake` (base px) and `--ui-refusal-shake-ms` while it plays. `ui.css` moves the control with `translate`, at the inherited `--ui-unit` or 1 where none is set, such as a pager outside the UI layer, and colours the control, and every element in it the game marks `data-ui-refusal-label`, with `--ui-refusal-colour`, which the game sets; a face drawn in `currentColor` turns red with its text.
  - `ui/buttonLayout`: `ButtonMetrics` contains caller-authored minimum `height`, `minWidth`, `paddingX` and `paddingY`. `buttonGroupSize(tokens, { size, labels, faceInsets? })` returns common outer dimensions for measured label line boxes, growing for wrapped labels. `layoutButton({ bounds, metrics, size, faceInsets?, placement?, footerBaseline? }, { label, role, labelBaselineOffset? })` returns contained `outer`, inset `face` and centred `label` rectangles. Face insets exclude lips and other artwork from label centring. Placement defaults to `"top"`; compact rows explicitly use `"center"`. `"footer"` requires an authored target baseline and measured offset from the label line box top. Missing metrics, invalid numbers and overflow throw `RangeError`. `withoutCurrentNavigation(current, buttons)` removes only navigation with a defined matching section, retaining actions, unsectioned navigation, ordering and metadata.
  - `layoutButton({ bounds, metrics, size, placement?, footerBaseline? }, { label, labelBaselineOffset?, role })` returns contained `face` and `label` rectangles plus the unchanged `role` (`"primary" | "secondary" | "navigation"`). `bounds` is the caller's control region excluding related copy and insets, and `size` is the shared group size. The label is always centred on both axes inside the face. External placement defaults to `"top"`; `"center"` centres the face vertically in the region. `"footer"` requires `footerBaseline` in caller coordinates and `labelBaselineOffset` from the measured label line box's top, with no guessed font metrics. Use a consistent authored font line box and baseline across footer controls; overflow or missing baseline data throws `RangeError`. `withoutCurrentNavigation(current, buttons)` omits only entries with `role: "navigation"` and a defined `section` equal to `current`; actions, unsectioned navigation, metadata and ordering remain intact.
  - `web/ui/dom/buttonLayout`: `setButtonSize(tokens, selection, element)` accepts a named size string or the pure measured group context and writes shared minimum dimensions and padding through `writeLayoutProperties`. `setButtonFrame({ faceInsets, borderWidths? }, element)` takes logical face insets and actual, already-rounded CSS-pixel border widths without changing native borders, nine-slice images or transforms. Reapply border widths after view-unit changes; scaled padding plus inset must cover each border, since CSS padding cannot be negative. `setButtonRole(role, element)` writes a presentation attribute for `primary`, `secondary` or `navigation`, independently of ARIA. `setControlPlacement(placement, element)` writes `top`, `center` or `footer` on its row.
  - `web/ui/dom/controls.css`: opt-in `ui-control-button`, `ui-control-label`, `ui-control-group`, `ui-control-row` and `ui-control-copy` classes provide face-centred labels, minimum-height growth, equal group dimensions and default external top alignment. `data-ui-axis="stack"` stacks equal-width controls. Footer groups align first-line baselines; supply measured common label dimensions after fonts, wrapping or view units change. Size resolves through `--ui-unit` and existing button-gap tokens. Fonts, colours, skins, rounded border lengths and pressed-face insets remain caller-owned. `ui-control-row` places one control beside its `ui-control-copy` cell (a reason or value) in normal flow, the button gap apart; it has no press outsets, so a group of actions whose press areas reach past their faces uses `actionGroup.css`.
  - `ui/controlPresentation`: `ControlAvailability` is `{ kind: "available" }`, `{ kind: "unavailable", reason }` or `{ kind: "omitted" }`. The caller determines relevance and requirements. `controlPresentation(state)` reports visibility, executability and the nonempty unavailable reason. Relevant unmet requirements remain visible; `invokeControl(state, action)` executes only an available action. Do not infer omission from cost or availability.
  - `web/ui/dom/controlPresentation`: `bindButtonAvailability({ getAvailability, reason, onUnavailable? }, button)` returns `refresh()` and `dispose()`. It keeps unmet controls focusable, renders the explanation into the supplied reason element, sets ARIA state and blocks unavailable clicks before normal action listeners. State is reread on every click; optional refusal feedback does not execute the action. Ancestor or earlier capture handlers and programmatic/context actions must use `invokeControl` with current state. Dispose with the control and its action listeners, since disposal removes the guard. `setPageDivider({ colour, thickness }, root)` defines one RGB-integer colour and logical thickness inherited by every `createPageDivider(document)` content separator. No per-screen overrides; HUD separators remain separate. `createDisclosure(document, { colour, width, height, strokeWidth })` reuses `vectorChrome` for one decorative, unfocusable right chevron. Its native parent owns accessible naming and navigation; executable actions receive no automatic chevron. Import `web/ui/dom/controlPresentation.css` for the shared content divider and disclosure dimensions.
  - `ui/layoutTree`: `LayoutNode<S>` is a keyed `row`, `stack`, `columns` or typed `component` tree. A schema maps component names to caller props and named slot unions (`never` for leaves). Structural nodes supply finite nonnegative `gap` and `padding`, optional `align: "top" | "center" | "baseline"` and ordered children. `validateLayoutTree(slots, tree)` rejects invalid metrics, duplicate sibling keys, cycles and undeclared components/slots before rendering. `layoutReport(viewport, observations)` reports `fit`, `overflow` or `unavailable`, with keyed-path required/available bounds, wrapped lines, clipping and overlap diagnostics in caller coordinates.
  - `web/ui/dom/layoutTree`: `mountLayout({ host, components, measure?, restoreFocus? }, tree)` returns `update(tree)`, `inspect(viewport)` and idempotent `dispose()`. Component ports declare slot names and `create(props)`, returning an actual `element`, named slot elements, `update(props)` and `dispose()`. Updates retain matching keyed components and authored order; component updates must preserve root and slot identities. Removed or changed components are disposed; `restoreFocus(removedPath)` delegates fallback focus to the caller. Existing host content remains. The physical `measure({ path, viewport }, element)` callback supplies required/available rectangles, wrapped line rectangles, clipping and disjoint-peer overlap paths; null or incomplete evidence reports unavailable. Measure only after fonts and art settle. Inspection never changes layout. Import `web/ui/dom/layoutTree.css` explicitly for structural grids, default top alignment and caller-authored gap/padding through `--ui-unit`; styles contain no font, palette, game labels or fit-by-clipping policy.
  - `ui/focusKeys`: `focusKeyAction(key, shift, repeat)` is `next` (Tab, Down, Right), `previous` (Shift+Tab, Up, Left), `press` (Enter, Space) or `close` (Escape, P), and repeats only step. `stepFocus(targets, focus, step)` steps in order, wrapping, from the first or last target when `focus` is none of them.
  - `ui/hitAreas`: `HIT_RULE` is the shared rule (`leastMargin` 6, `marginShare` 0.25, `minTarget` 48, `mostMargin` 16) that every game passes as `rule`. `hitMargin(rule, art)` is `clamp(leastMargin, mostMargin, marginShare x shorter side)`; `hitAround(rule, art)` grows `art` by it, then to `minTarget` on each axis about its centre. `pressedArea(areas, point)` returns the key of the area whose `hit` (a rect, a circle optionally cut toward `awayFrom`, or a union) holds `point` and whose drawn `art` centre is nearest, the earlier on a tie.
  - `ui/spacing`: the gaps between neighbouring button faces in every game. `BUTTON_GAP` is 16 base px between standard buttons side by side. `SMALL_BUTTON_GAP` is 24 base px, between small buttons in any direction, stacks included, whose faces are smaller than a standard button's (discs in larger press targets, compact text buttons), so a press lands on the intended one. `STACK_BUTTON_GAP` is 8 base px, between standard buttons stacked vertically. Phaser and TypeScript layouts use the constants; HTML UI uses `--ui-button-gap`, `--ui-small-button-gap` and `--ui-stack-button-gap`, which `ui.css` defines on `.ui-layer` as `units()` of each constant, so they resolve at the layer's `--ui-unit` and descendants inherit those lengths. They are undefined outside `.ui-layer`.
  - `ui/actionGroup`: `arrangeActions(context, items)` places `{ key, role, size, hidden?, locked? }` faces as a row when they fit `width` at full size, otherwise as a stack; `arrangeActionGrid(context, items)` places them in rows of columns and `separatePressAreas(members)` clamps press areas between groups and boxes. See [Action groups and UI theme](#action-groups-and-ui-theme).
  - `web/ui/dom/actionGroup`: `createActionGroup(document, { className? })` returns `element`, `arrange(context, actions)`, `arrangeGrid(context, actions)`, `measure(elements)` and `dispose()`, and `createPressContext(root)` returns `add`, `remove`, `apply` and `dispose`; load `actionGroup.css`.
  - `ui/uiTheme`: `UI_COLOUR_ROLES`, `TEXT_ROLES`, `BUTTON_RESET_CLASS`, `BUTTON_FRAME_CLASS`, `BUTTON_FRAME_CONTENT_CLASS`, `GAME_TEXT_ROLE_CLASS`, `colourProperty(role)`, `textRoleClass(role)`, `colourProperties(colours)`, `textRoleProperties(roles)`, `gameTextRoleProperties(roles)` and `gameTextRoleReferences(role)`.
  - `web/ui/dom/uiTheme`: `setUiColours(colours, root)`, `setTextRoles(roles, root)` and `setGameTextRoles(roles, root)` write the slots on a theme root and `setTextRole(role, element)` gives an element its role; load `uiTheme.css`, and `buttonFrame.css` for button frames.
- **Input:** callers supply event coordinates, timestamps, equality, hold thresholds, drag/fling tuning and reduced-motion policy. Clients perform returned actions and apply modal gates to their input routes.
- **Install offer:** `web/pwa/dom/installFlow`'s `watchInstall(window)` holds the browser's install prompt and reports `installed`, `prompt` or `steps`; `offersInstall` is true unless installed. `install()` calls the prompt before any await, so the tap still counts as the gesture, and returns `accepted`, `dismissed` or `steps`. On `steps` the game shows its words for `stepsKind`, one of the `InstallStepsKind` values `installStepsKind(userAgent, maxTouchPoints)` chooses: `chromiumAndroid`, `chromiumDesktop`, `firefoxAndroid`, `firefoxDesktop`, `ios`, `other`, `safariMac` or `samsungInternet`. `other` covers unlisted browsers, Opera and WebViews. `wireInstallButton(flow, button, steps)` hides the button only once installed and opens the `steps` dialog on its `[data-steps="<kind>"]` section, titled by its `h2`, or its `other` section where the dialog has none for the kind; the dialog's first button closes it. The game supplies every string and the markup.
- **Motion:** games validate finite coordinates, starts and nonnegative durations. Zero duration changes instantly at its start; infinite query positions select endpoints. Games retain clocks and randomness. `motion` re-exports the `Point` type from `rect`.
- **Launch:** `web/pwa/dom/launch`'s `createLaunch(context, options).run()`, with the `context` of a `supported` `prepareBrowserLaunch(preparation, policy)` result, runs once before game construction or save access; only `"reloading"` suppresses startup. With no active build it registers the router (`updateViaCache: "none"`), reads `build.json` with `no-store`, pins that manifest, reduced to the sound alternatives in `soundFormat` (`buildRecords`' `installedManifest`), or, for a grouped build, the groups `installedPointer` keeps for that format, and installs it in the foreground (6 lanes, default priority), reporting `onProgress` and, on a `network` or `verification` failure, `onFailure({ reason, retry })`, whose retry resumes from stored entries. When the router cannot register (`unsupported`) or storage is full (`quota`), it calls `onNetworkPlay({ reason })` once and resolves `"play"` from the network; each later launch tries the install again. The document a first install reloads into reports the carried progress at once. A redeploy mid-install restarts on the new manifest; the old document then reloads once into the new build instead of resolving `"play"`, and a network play reloads once onto the newer deployed build. With an active build it resolves `"play"` and checks `build.json` after reclaiming unused builds. A complete staged build normally promotes at the next cold launch. The page can reload once into the router if it still finds a distinct complete staged build at startup. Visibility return, window focus, reconnect and caller requests to `requestUpdateCheck()` share ordinary discovery while visible and online. Call the hook on genuine start-of-play and return-to-Start/Home transitions. An ordinary wake during `UPDATE_CHECK_MS` defers one check until the cooldown expires. The page does not poll continuously. It stages a newer build in the background (2 lanes, `low`, paused while hidden). Staging reports `onUpdateState` and optional `onUpdateProgress`, never `onFailure`; a failed staging retries while the page stays visible, after `UPDATE_RETRY_MS` (60 s) and then twice the previous wait up to `UPDATE_RETRY_MAX_MS` (15 minutes), cancelled while hidden and on `dispose()`. Staging fires `onUpdateReady({ version, updateNow, dismiss })` once per staged version on any screen; the game draws its prompt and pauses play. `updateNow(save)` awaits `save`, then revalidates the offer before activation and reload. On dismissal the game restores the previous view, focus and pause state. The staged build stays available for the next cold launch. Focus and scene transitions within the same document only wake discovery.
- **Required update:** a save written by a newer game calls `launch.requireNewer()`, which never offers the update. A complete staged build, or a newer build another window already activated, switches at once; otherwise it checks `build.json` and stages the newer build, then switches. Keep Start, save loading and writes blocked for both `onRequireNewer` states, `"updating"` and `"unavailable"`; neither releases the save guard. Unavailable retries on online and visibility events.
- **Build store:** `web/pwa/dom/buildStore` keeps one cache per build version, `<prefix>build-<version>`, and a records cache, `<prefix>records`, holding the `active` and `staged` records, one pin per window client and each build's manifest as this device installs it (reduced to its `soundFormat`, which it records), each under its own key (`buildContract`'s `ACTIVE_RECORD_PATH`, `STAGED_RECORD_PATH`, `pinRecordPath` and `buildManifestUrl`), so no write overwrites another. A record body is `{"version": string}`; an absent record has no entry. Callers write a record only after verifying what it names. `reclaim(documentVersions)` deletes every build neither active, staged, named by a pin nor in `documentVersions`; the router deletes closed clients' pins, so a pin names a build a live window runs.
- **Install:** `web/pwa/dom/buildInstaller`'s `installBuild(context, options)` saves the pinned manifest, copies each missing file another build holds by digest without hashing it again, then fetches the rest, unhashed files and verified JSON with `cache: "no-store"` and files under the policy's `hashedAssetPrefix` in the default mode, which the HTTP cache may answer, streaming each body against the manifest's exact size and full SHA-256 before storing it with its `x-game-kit-sha256` header. `storage.persist()` and `estimate()` run first, so a full quota fails early. The foreground defaults (`FOREGROUND_INSTALL`) are six lanes at default priority, three attempts per file one and three seconds apart, and a 30 s inactivity timeout per attempt; `BACKGROUND_INSTALL` uses two lanes at `low` priority, and launch pauses it while the page is hidden. Only files the build cache lacks are fetched, so a later call resumes an interrupted install. A body that differs from the pinned manifest resolves `"changed"`, and launch re-reads `build.json` and installs the new manifest, reusing every verified entry. Completion is a metadata check: every file present with its digest header.
- **Router:** `web/pwa/dom/serviceWorker`'s `runServiceWorker(policy)` serves each same-origin GET from the build its window is pinned to, or from the active build for a window with no pin, and pins the window to the build that served it. It deletes the pins of clients `clients.matchAll({ includeUncontrolled: true, type: "all" })` no longer lists, at activate and on navigation at most once per `PIN_PRUNE_MS` (one minute), sparing pins it wrote within that time. A routed navigation without a resulting-client pin, such as an ordinary reload, first promotes a complete staged build to active. Without a usable build, the router falls back to the network. A navigation missing from the selected build goes to the network without a new pin. An unlisted subresource goes to the network too, but the worker can already have pinned its requesting client. For grouped sound requests, the router can also find recovered audio outside its original snapshot. A `no-store` request goes to the network; the installer's default-mode request for a hashed file may be served from the window's build, since a hashed URL always has the same bytes. For an ordinary listed cache miss, the router checks that the network response is complete, non-redirected, and matches the pinned manifest's size and SHA-256 before serving or caching it. Verified JSON uses its separate response checks before serving.
- **Pixel fonts:** `PixelFontContext` supplies glyph bits, widths, height, spacing and space width. The kit returns geometry and advances; clients own glyph definitions and normalization. Phaser registration takes explicit font options and throws an `Error` naming the key when that texture key is invalid or already in use without a cached font.
- **Progress:** a loading bar shows nothing while idle; measured work fills left to right, shows full for a hold once it finishes, then disappears; work of unknown total (`undefined`) shows an indeterminate segment travelling left to right, entering at the left edge and leaving at the right, once a cycle, and disappears at once when it finishes. A game shows its loading bar only for loads the player waits for: boot, entering a level or area, the first install (`createLaunch`'s `onProgress`) and a forced update (`onRequireNewer`'s `"updating"`). Background loads during play, such as art fetched ahead of need, never report to the loading bar's progress state. A finished measured bar may fade out linearly over a fade after its hold (default 0, nonnegative and finite). Reduced motion changes neither the segment nor the fade. `ProgressBarStyle` is `{ border, fills, frame, frameAlpha?, track, trackAlpha? }` with 0xrrggbb colours; `frameAlpha` and `trackAlpha` are the frame's and track's opacity in [0, 1], default 1, zero drawing nothing, and the fills are always opaque. `checkProgressBarStyle` throws a `RangeError` on an alpha that is nonfinite or outside [0, 1]; both renderers call it. `createProgressState` replaces the previous operation on `begin`; stale handles cannot update or finish its replacement. `ProgressMotion` is `{ cycleMs, segment }`, the segment's width a share of the track in (0, 1]; `checkProgressMotion` throws a `RangeError` on a nonpositive or nonfinite cycle or a segment outside that range. `progressBarLayout(style, frame, progress)` lays out a measured share, clamped to zero through one, nonfinite as zero. Clients own labels, placement, scaling and the timing values.
  - Phaser: `createProgressDisplay(fullMs, fadeMs = 0)` turns snapshots (`report`, which `subscribe` accepts directly) into the `ProgressDisplay` to draw at the caller's time (`at(nowMs)`): `hidden`, `measured` with a `value`, or `indeterminate` with the `elapsedMs` since its first drawn frame; the first call after a finish shows full, so a full frame is drawn even at `fullMs` 0. From `fullMs` to `fullMs + fadeMs` after that first frame the full display carries an `opacity` falling linearly from 1 towards 0, and it is hidden from `fullMs + fadeMs`; outside the fade `measured` has no `opacity`, which means opaque. `progressDisplayLayout` carries the opacity onto the layout, and `drawProgressDisplay` multiplies it into every `fillStyle` alpha, so each rect blends separately rather than as one group. `indeterminateTravel(motion, width)` is the segment's `length` in whole pixels and the `steps` its leading edge takes each cycle, one per pixel, each held for an equal share of the cycle; `indeterminateSegment(motion, width, elapsedMs)` is the segment's visible span in whole pixels at that step and `progressDisplayLayout(style, motion, frame, display)` the layout, `undefined` while hidden. `drawProgressBar(graphics, style, frame, progress)` draws a measured bar such as a gameplay meter, and `drawProgressDisplay(graphics, style, motion, frame, display)` a display, nothing while hidden. Both draw the frame and track at their alphas with `fillStyle(colour, alpha)` and skip a rect whose alpha is 0. Neither owns a clock: the caller clears its graphics and redraws each frame.
  - Layers: `createLayeredProgress(timer, hold, { background, foreground })` composes two `ProgressSource`s (anything with `subscribe`, such as `createProgressState`) into the one snapshot stream a bar follows, which both renderers take unchanged. The foreground is the loads the player waits for; the background is a forced update, of unknown total or measured. The foreground shows whenever it is active, and the background whenever it alone is. When the shown layer's measured work finishes, the stream reports idle, so the bar holds full for `fullMs` and fades over `fadeMs` (`ProgressHold`, the bar's own timing, checked as above), and nothing else shows until both have passed on `timer` (`clock/timer`'s `Timer`, such as `window`); a foreground operation that begins meanwhile cuts the hold short and shows at once on the same bar. Work of unknown total that finishes hands over at once, with no hold or fade. Idle shows nothing: the DOM bar is hidden and the Phaser display `hidden`. Subscription reports the current snapshot at once; `dispose()` stops following the layers and cancels a hold.
  - Loads: pass `load/loaderConfig`'s `LOADER_CONFIG`, `{ maxRetries: 2, timeout: 30000 }`, as the Phaser game config's `loader`. Each file request then times out after 30 s and is tried twice more after a timeout or network error (an HTTP error status fails at once); the file then counts as failed and its run still completes, so a load run cannot hang. `load/phaser/watchLoader`'s `watchLoader({ console, progress, timer }, scene)` follows a scene's loader from `init` or `preload` until the scene shuts down or is destroyed, or until `dispose()`; create it each time the scene starts, before queueing files. Its pending retry rounds end with it, so a scene whose failed files should be retried keeps running until `failures()` is empty. It sets the loader's timeout on each queued file whose own is unset, each file of a multi-file load included, because Phaser 4.2.1 does not apply the game config's timeout to requests. A run's measured share is `load/fileShare`'s `createFileShare`: settled files, loaded or failed, counted against the run's total, never moving backward. While the total stays put it is done / total; when the run queues more files it keeps the share shown so far as a base and fills the rest by the files settled since, `base + (1 - base) * (done - doneAtGrowth) / (total - doneAtGrowth)`, reaching exactly 1 when every file has settled. `waitFor(label)`, with a label the game chooses, marks a load the player waits for: the run under way, joined from its share so far, or else the next run, from 0; a later mark before the run starts replaces an earlier one, and a measured run keeps its label (`waited()`). A marked run begins an operation on `progress` (the foreground state) as it starts, reports its share and finishes at 1 as it completes. An empty marked run, which Phaser starts and completes at once, begins and ends at once and leaves no mark. Every other run, such as on-demand art and the retry rounds, reports nothing; a marked run is measured whoever starts it.
  - Failed files: each file that fails after the loader's retries is logged once with `console.warn` (`Loading <url> failed after <n> attempts; retrying later`) and its load recorded; `failures()` lists the recorded `LoadFailure`s, `{ config, key, rounds, type, url }`. A multi-file load, queued by one of `MULTI_FILE_METHODS` (`aseprite`, `atlas`, `atlasPCT`, `atlasXML`, `audioSprite`, `bitmapFont`, `multiatlas`, `scripts`, `texture` and `unityAtlas`), is recorded once however many of its files fail: its prefixed key, the arguments its method was called with as `config`, the method as `type` and the URL of its first failed file. A run that completes with recorded loads schedules one retry round on `timer`, unless one is pending, `RETRY_ROUNDS_MS` (15 s, 60 s, 300 s) after that completion by the fewest rounds any recorded load has had. The round queues every recorded load again, and starts the loader when it is idle, a silent run, or adds them to the run under way, so rounds never overlap. A single file is queued with its key, URL and options through its type's loader method (`image`, `json`, `spritesheet` or `svg`); a multi-file load is queued whole through the method that queued it, with its original arguments, base URL, path and prefix, so none of its files is queued twice or left out. A load that fails again is recorded again, and one that fails its third round is logged as given up and dropped. While the watch lasts it wraps each `MULTI_FILE_METHODS` method on the loader to capture its calls, one call per config when given an array of configs, and `dispose()` restores them. A file of another type (such as audio), a linked file outside a multi-file load (an image or sprite sheet with a normal map), and a file of a multi-file load queued before the watch started or by another method (such as a plugin's) are logged as not retried.
  - DOM: `createDomProgressBar({ style, frame, timing }, parent)` mounts pending and returns `{ element, remove, report, update }`. `update(value)` shows a measured value, or the travelling segment for `undefined` or a nonfinite value; `report(snapshot)` follows a progress state, hidden (the `hidden` attribute) while idle and once unknown work finishes, and full until the hold ends once measured work finishes. `timing` is `{ cycleMs, fadeMs?, fullMs, segment }`, checked as above with `fullMs` and `fadeMs` nonnegative and finite, and written as `--progress-bar-cycle`, `--progress-bar-full` and `--progress-bar-fade` (ms, `fadeMs` default 0) and `--progress-bar-segment`; without it the stylesheet's 1500 ms cycle, 0.25 segment, 250 ms hold and 0 ms fade apply. A complete bar stays opaque for the hold, fades its `opacity` linearly to 0 over the fade and is then hidden (`visibility: hidden`), with no script frames. The frame and track background colours carry `frameAlpha` and `trackAlpha` as `rgba()`, opaque colours staying `#rrggbb`. With `timing` the script also writes `progressBarPixelProperties(style, motion, frame)`: `--progress-bar-segment-width`, the segment's whole-pixel `length` in px, and `--progress-bar-steps`, its `steps`; with both set the stylesheet draws that width and steps the travel one pixel at a time with `steps(n, end)`, so each frame shows `indeterminateSegment`'s span for the time since the animation started. Without them, as before any script runs or without `timing`, the segment is `--progress-bar-segment` of the track wide and travels continuously; static CSS may set both properties on the `.progress-bar` to step pre-script markup too. The motion and the hold run from `web/progress/dom/progressBar.css` alone, which the game imports; script writes geometry as CSSOM properties and the rest as custom properties and attributes, never style text, and drives no frames. The markup is `.progress-bar[data-state]` (`pending`, `determinate`, `complete` or `idle`, with `aria-valuenow` except while pending or idle) holding the track, then one `.progress-bar-band` clip per fill colour, each holding one coloured block segment; while pending each band spans its fill row across the track (`progressBarLayout(style, frame, 1).fills`). Markup written before any script runs animates from the same stylesheet.
- **Rendering:** `mountModalBackdrop(context, area)` owns its unique texture and display object and exposes `ready` and `destroy()`. It falls back when snapshot capture rejects. `snapshotRemapped` reads the area at the WebGL renderer's post-render point with Phaser's snapshot geometry, row order and un-premultiplication, or through `snapshotArea` on the Canvas renderer, and writes the remapped pixels into a canvas texture. The client owns modal layout, input and pausing. `view/phaser/tilemapCull`'s `cullToCameraView(layer)` replaces an orthogonal layer's cull with one over `cameraTileBounds(camera, data)`: the tiles inside the area the camera shows for its own `originX` and `originY` (Phaser 4.2.1 culls to `worldView`, placed as if the zoom were about the centre, so a camera with another origin at a zoom other than 1 leaves out a band of the tiles it shows), at the map's tile size times the layer's scale and padded by the layer's `cullPaddingX` and `cullPaddingY` tiles. For origin 0.5 the bounds equal Phaser's own. A layer with `skipCull` or a scroll factor other than 1 keeps every tile, and a layer that is not orthogonal throws.
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

| Module                | Builds                                                                                                                                                                             | Queries                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `terrain/movementMap` | `buildMovementMap(options, profile, area)`: ground spans; `walk`, `jump`, `drop`, `wall-top`, `climb` and `track-climb` edges witnessed by the kernel; Dijkstra queries on seconds | `locate`, `pathTo`, `nearestReachable`, `pathOrNearest`, `reachableSet`, `sinks`; `mapCanonical`, `mapHash` |
| `terrain/airMap`      | `buildAirMap(options, profile, area)`: flyer cell grid, `fly` edges and perch `land`/`lift`; A\* queries with an axis-change penalty                                               | `locateAir`, `airPath`, `nearestReachableAir`, `reachableAir`, `sinksAir`; `airMapCanonical`, `airMapHash`  |

Node and edge construction, window clipping and the canonical line format are documented on `buildMovementMap`, `mapCanonical`, `buildAirMap` and `airMapCanonical`. Caller contracts common to both:

- Built geometry is static. Movers, crumbling supports and timed hazards stay with the caller, which names them through `deps` and disables them per query through the mask. Invalid input throws `RangeError`.
- An optional `window` builds only the part of the map inside it; ids belong to one map, so carry positions between maps as hitboxes through `locate` or `locateAir`. In an air map window, a path costs the same as the full map's when the full map's least-cost path lies inside it; rebuild around the subject when it or its goal nears the window's edge.
- Area callbacks (`blocked`, `deps` and the movement map's `kind`) must be pure: builds call them in no promised order and skip states they can prove produce no edge.
- Queries are pure and cache nothing: cache per (from, goal, mask key). Ties go to the lower node id.
- Movement map queries settle each edge once, at its earliest arrival the mask accepts, in order of seconds, then node id, then edge id. Equal seconds over one edge go to the arrival generated first, which is the one whose predecessor settled first. Masks must be pure within a query: each node verdict is asked once, and an edge's only for an arrival earlier than every arrival it already accepted for that edge.
- Movement queries accept `MapQueryContext extends MapMask` at the existing mask argument. Its optional `onWork` receives one `MapQueryWork` on normal completion, including a masked start, no path or a fallback. `nodesReached` sums first arrivals per node, `arrivalsSettled` counts processed nonstale arrivals including the start, and `heapPushes`/`heapPops` count actual heap operations including stale entries. `sinks` sums its internal searches; `pathOrNearest` uses one search. Without an observer there is no diagnostics object or counter updates. Validation, mask and predicate errors produce no callback; observer errors propagate.
- Hashes are FNV-1a 64 of the canonical form; build and queries use no `Math.random`, `Date` or `performance`.

## Achievements

`achievements` judges a game's badge catalogue, orders and awards badges, keeps the earned record in its own versioned save (so a progress reset keeps it) and queues unlock notices. The game owns the condition union, scopes, facts, tiers, strings, art, tracking points and storage keys and versions. `achievements/preview` previews the badges ending the run now would earn, each at most once a run and without awarding. Push the loaded record's `unannounced` ids into `CelebrationQueue` at start, and call `announced` when a notice starts. Progress rules, ordering and store semantics are documented in `src/achievements.ts` and `src/achievements/preview.ts`.

## Utility scoring

`ai/utility` scores candidate actions as `gate × base × Π curveValue × multiplier` and chooses one with hysteresis and a single seeded draw among near-equal scores, so replays from the same seed and inputs choose the same actions. Games own the inputs, actions, values and behaviour. Curves, hold rules and result reasons are documented in `src/ai/utility.ts`.

## Testing fixtures

Fixtures for game unit tests. They import no test framework and load no Phaser at runtime, so a test that mocks `phaser` needs no inlining for them.

- **Save storage:** `storageFixture(failures?, entries?)` from `test/storageFixture` is a `SaveStorage` over the `entries` Map. It exposes `entries` and the mutable `failures`, which are checked on each call. `unavailable` rejects every call with an `Error` named `SecurityError`, as blocked site data does. `quota` is the most characters the keys and values may hold together, or a predicate that is true when a write exceeds it; such a write rejects with an `Error` named `QuotaExceededError` and changes nothing. `readThrows` and `writeThrows`, when present, are the rejection of every read or write. `saveStore` reports each as `unavailable`. The `memoryStorage(entries)` in `runtime/save/storage` is unchanged.
- **Web Storage:** `failingLocalStorage(failures?, entries?)` from `test/dom/failingLocalStorage` is a synchronous `Storage` (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`) over `entries` with the same `failures`, thrown instead of rejected. `getItem`, `key` and `length` are reads; `setItem`, `removeItem` and `clear` are writes, and only `setItem` is held to the quota. Stub it as the page's storage with `vi.stubGlobal("localStorage", failingLocalStorage(failures))` to test `runtime/web/save/dom/localSaveStorage`, which `saveStore` then reports as it does browser storage.
- **Scene stand-in:** `sceneStub(spy, overrides?, options?)` from `test/phaser/sceneStub` takes a spy factory such as `vi.fn` or `jest.fn`. Methods are spies typed with Phaser's signatures that return their owner where Phaser returns `this`; read their calls with `vi.mocked`. `src/testing/phaser/sceneStub.ts` documents each member's behaviour. It provides:
  - `add` (`bitmapText`, `container`, `graphics`, `image`, `nineslice`, `rectangle` and `sprite`) and `make.graphics`, each returning a `StubGameObject`: an emitter whose setters record their values and return it, whose `destroy` deactivates it and emits `destroy`, and which `add` puts on `children.list`.
  - `anims` (`create`, `exists` and `get` over a Map) and `cache.bitmapFont` and `cache.json` (`add`, `exists`, `get` and `remove`, each over its own Map).
  - `cameras`: `main` at 1024 by 768 with scroll, bounds, visibility, zoom, `ignore` and `pan`, the `cameras` array holding it, and `add` and `remove`.
  - `events`, `game.events`, `input` (enabled, with an enabled `keyboard` emitter, `manager.pointers` and `stopPropagation`), `load` (`bitmapFont`, `image`, `json`, `setPath` and an empty `list` Set) and `scale` (at the game size): emitters with `on`, `once`, `off`, `emit`, `addListener`, `removeListener`, `removeAllListeners`, `listeners`, `listenerCount` and `eventNames`, which lists only events with listeners.
  - `game.canvas`, `game.loop` (`time`, `delta` and `now` at 0), `game.renderer.snapshotArea` (records, never calls back) and `game.scene.getScenes`.
  - `scene` (`key`, `get`, `launch`, `start`, `stop`, `pause`, `resume`, `isActive`, `isPaused`, `moveAbove` and `setVisible`) and `sys` (`isActive`, `isPaused` and `settings.key`). Statuses change at once rather than at Phaser's next step; `get` returns the stub for its own key.
  - `textures`: `exists`, `get`, `getFrame`, `createCanvas` (a canvas texture whose 2D context keeps `putImageData` pixels for `getImageData`), `addImage` and `remove` over `list`, which a test seeds by key with `StubTexture` values; `get` returns one shared `__MISSING` texture with no sources for any other key, as Phaser does.
  - `time` (`now` at 0, `addEvent` and `delayedCall` returning timer events that never fire) and `tweens.add` (a tween that never plays). A test runs a scheduled callback from the spy's calls.

  `options` are `key` (the scene key, `"default"` when absent) and `anyTexture` and `anyAnimation`, which make `textures.exists` and `anims.exists` true for every key. The stub's members are complete and frozen: tests extend it through `overrides`, not new members. An override member that is an object literal merges into the stub's member one level deep, its own properties and getters replacing or adding to the member's, so `{ scene: { get } }` keeps the other `scene` spies; any other value (a class instance such as an `EventEmitter`, a function, an array or another stub's emitter) replaces the member, and a member the stub lacks is added. Code typed with `Scene` takes the stub with `as unknown as Scene`. For game scenes to extend it, a `vi.mock("phaser")` factory imports it with `await import` and returns `Scene: class { constructor() { Object.assign(this, sceneStub(vi.fn)); } }`.

## Numbers and text measurement

- `numbers.clamp(minimum, maximum, value)` does not reorder bounds and propagates NaN; `lerp` does not clamp. See `src/numbers.ts`.
- `text/bitmapFont.advanceWidth` measures pen advance, including trailing whitespace; `inkWidth` measures inked columns. See `src/text/bitmapFont.ts`.
- `runtime/lines.splitBalancedGraphemes(measure, text)` returns two nonempty strings at a Unicode grapheme boundary, preserving the exact input. It measures every complete prefix/suffix pair and minimizes maximum width, then width difference, then boundary position. Empty or single-grapheme input returns `undefined` without measuring. Measurements must be finite and nonnegative or it throws `RangeError`; callback errors propagate. The caller can apply it to overwide words after `wrapWords`; it supplies no width limit or font policy and requires `Intl.Segmenter`.

## Standalone verification

```bash
make check
```

`make check` verifies the current working tree in stock images through `tests/container/stock`. The host needs Make, Git, Docker and Node 24.21.0 or newer. ShellCheck runs in `koalaman/shellcheck:v0.11.0` against a read-only source copy. The Node image named by `.nvmrc` copies the source into writable scratch, installs dependencies with `npm ci` from the lockfile, then runs the type checks, Prettier, ESLint, the tests and an unstamped distribution compile. All outputs stay in the container. Containers run as uid/gid 19001 with a read-only root filesystem, at most four CPUs, 4 GiB of memory and an open-file limit of 256.

`make lint`, `make test` and `make build` run one part of that check through the same runner and containers: `make lint` runs ShellCheck, the type checks, Prettier and ESLint, `make test` runs the tests, and `make build` compiles the unstamped distribution, which stays in the container. The host runs the Node launcher. ShellCheck, dependency installation and each selected check run in containers. The stock runner invokes the Markdown lint library entry point, which exits without checking Markdown. Run `npm run lint:markdown` in a dependency-installed isolated checkout to run the Markdown CLI used by CI.

Native npm scripts run the tools directly. Use `npm run lint` (`lint:shell`, `lint:markdown`, `lint:types` and `lint:node` in turn) and `npm test` for working-tree checks, or focus a test run with `npm test -- src/terrain/movementMap.test.ts`. Vitest uses at most four workers. TypeScript accepts only erasable syntax (`erasableSyntaxOnly`), so no enums, namespaces or parameter properties. `npm run format` applies Prettier and ESLint fixes. `npm run check` includes the release build after lint and test. For `npm run build`, use a clean Git checkout and set `SOURCE_COMMIT` to its full HEAD and `SOURCE_DATE_EPOCH` to the commit timestamp. The builder compiles from that commit's Git archive and proves `.claude/release-output/game-kit-<version>.tgz` with `SHA256SUMS` and `SOURCE_COMMIT`. CI runs the same npm scripts and uploads the release output. The workflow skips browser tests, unit tests and the release build when its changed-path check finds changes exclusively under `docs/`. A root `README.md` change runs those jobs. Tags, new branches, forced pushes and manual runs run every job.

`npm run test:e2e` runs the browser install and update check, `tests/e2e/run.ts`, through `tests/container/e2e` in the `mcr.microsoft.com/playwright` image whose version equals the exact `playwright-core` pin. The container has an open-file limit of 4096, since Chromium's Cache Storage fails writes under 256 (`CHECK_NOFILE` sets it). The check builds a fixture game with `precachePlugin`, serves it with Cloudflare's HTTP/3 `priority` and `server-timing` headers, throttles every page and service worker to 1.6 Mbit/s with 300 ms latency and every page to a 4x slower CPU over CDP, and drives Chromium through a first install that resumes after a reload, a worker stop and a redeploy, offline play, a delta update with its in-session offer and dismissal, silent launch promotion, `updateNow` and a failed background update. The default per-file mode uses fewer than 100 files. CI runs it and `npm run test:e2e -- --grouped`. Run `npm run test:e2e -- --whole-build` for the whole-build archive check. `npm run test:e2e:long` is per-file only and uses larger fixture files (about 68 MB total), so the first install runs past five minutes. The harness rejects unknown flags, positional arguments and combinations of modes before building fixtures.

`node scripts/check.ts <directory>` uses the same local runner in release mode from a clean checkout. The host needs Git, Docker, Node 24.21.0 or newer, tar and GNU timeout. ShellCheck reads a host scratch snapshot through its read-only mount. One pinned Git archive supplies types, lint, tests, packaging and the native Node, declaration and Vite artifact proof. The gate exports the checked artifacts after package proof and source fingerprint checks pass. The runner waits up to 15 minutes for one-minute load below 20 before a container start. The npm cache volume defaults to `game-kit-npm-cache`. Set `GAME_KIT_NPM_CACHE` to use another volume, or transfer cache contents with `node scripts/npm-cache.ts load|save <directory>`. Only a confirmed offline cache miss triggers a fill. Other install failures keep the npm diagnostic in the gate evidence. The gate refuses credential-shaped source paths before reading their bytes.

WORKAROUND: The `markdownlint-cli2@0.24.0` development override selects `markdownlint` `0.42.1` for patched [re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) and [KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) `0.19.1`. Other parent-scoped overrides pin [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) `11.0.3`. ESLint loads cycle detection and its resolver through exported plugin subpaths because the full plugin imports an unused rule requiring minimatch's removed `makeRe` API. Keep cycle detection enabled. Remove each override when its parent supports the patched version; restore the full plugin import when it supports minimatch 11.

## Release artifacts and consumer proof

[GitHub releases](https://github.com/andornaut/game-kit/releases) distribute `game-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS`; there is no npm registry publication.

`node scripts/pack.ts <output-directory>` packages the pinned committed HEAD offline from the npm cache volume. It compiles JavaScript and declarations with `tsconfig.release.json` and packages the manifest, `SOURCE_COMMIT`, README and licence. The archive excludes TypeScript source, tests, scripts and development commands. The committed gate and CI use this same package builder and prove the resulting tarball. The builder removes its temporary package staging directory after each attempt. The commit timestamp supplies `SOURCE_DATE_EPOCH` for reproducible checksums.

```bash
GAME_KIT_ARCHIE_CACHE=<Archie-npm-cache> GAME_KIT_CHIBI_CACHE=<Chibi-npm-cache> \
node scripts/check-release-consumers.ts \
  <artifact.tgz> <sha256> <source-commit> \
  <Archie-repository> <Archie-revision> <Chibi-repository> <Chibi-revision>
```

The proof installs the exact artifact into immutable Archie and Chibi snapshots, offline. It checks the installed bytes, lockfile integrity, kit imports, and Vite and Vitest configuration, then runs each game's `typecheck` and `test:game-kit` scripts. A missing script fails proof. Use populated read-only offline caches for both games. The printed `release-consumers.archie-chibi.*` evidence directory records the scope as `archie-chibi-proof`. The tarball's own exports, native imports and declarations are checked by the gate on the same bytes.

A single-game proof uses only that game's repository, revision and cache:

```bash
GAME_KIT_CHIBI_CACHE=<Chibi-npm-cache> \
node scripts/check-release-consumers.ts --game chibi \
  <artifact.tgz> <sha256> <source-commit> <Chibi-repository> <Chibi-revision>
```

Use `--game archie` with `GAME_KIT_ARCHIE_CACHE` for Archie. A single-game run only reads inputs for that game and writes a `release-consumers.archie.*` or `release-consumers.chibi.*` directory. A successful run records `PARTIAL PASS` and `incomplete-release-proof`.

For combined consumer evidence, retain the Archie and Chibi receipt and Ada's separate pinned consumer result from its existing isolated verification. Record the exact Ada, Archie and Chibi revisions, and match the kit source commit and tarball SHA256 across both sets of evidence. Retain Ada's frozen install and kit check result with the release receipt.

Tag a release only after every required workflow is green for that `main` commit and the artifact passes the consumer proof. Tags and release assets are never moved.

## Licence

[MIT](LICENSE) covers helper code. Consuming games retain their own art, font and content licences.
