# Migration and release notes

Check the entries for the versions you are crossing. Historical entries use the public paths and behaviour of their release.

[Reference](README.md)

## Confirmed platform exit in 0.95.0

Use [the scoped Back guard](pwa-integration.md#platform-back-and-confirmed-exit) when a game
needs to release platform navigation after confirmation. The page-lifetime `guardBackNavigation`
interface is still available for existing callers.

## Turned action sizing in 0.94.2

`createActionGroup().measure()` measures the layout border box before a frame turn. Button
sizes still round up to whole base units, including at fractional fit scales.

## Migration to 0.92.0

The precache plugin now rejects `fetch-json-data-v1` with grouped or whole-build archive
updates. Use per-file updates to keep that profile. For archive updates, use the URL-array
form only for JSON families that meet its URL-independent response contract.

## Placed row heights and one-action centring in 0.91.0

- Additive. A placed form row list takes a height per row through `rows.place(context, [{ element, height }])` or `FormRowsRow.height` in `formRowsGeometry`. Heights use whole units. A row without one is a slider's `layout.height` or the layout's `height`. Each row's track, padding, icon, switch, lane, art-locked sizes and press dip follow its own height, so rows of different heights share one list instead of one list per height. Lists without per-row heights render as in 0.90.0.
- Changed. A one-action row's face is centred in the whole row, the list's padding included, with the odd unit right and below. It was centred inside the padding. A one-action row in a list with unequal left and right, or top and bottom, padding moves its face, and the face must fit the row rather than its content. In CSS the row takes no padding, and on a placed list `--ui-form-action-top` is from the row's top. A game that gave its one-action row an unpadded list of its own can place it in the shared list. Rows without an action are unchanged.

## Migration to 0.78.0

Breaking. `runtime/web/pwa/dom/launch` no longer exports the deprecated
`browserLaunchContext`. Call `prepareBrowserLaunch({ parent, onUnsupported }, policy)`
and pass a `supported` result's `context` to `createLaunch`, as in
[Production startup](pwa-integration.md#production-startup). An `unsupported` result has already shown
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
the build emits, including whole-build archives, groups with sound formats and
transports, and grouped first installs. Earlier releases rejected any pointer
with `archive`, `groups` or `groupedFirstInstall`.

## Codec-aware groups in 0.72.0

`updateGroup` builds now split each group's sound alternatives into one group
per format, so group digests and counts change once and a build near the
100-group cap can exceed it. Grouped installs and updates skip groups of other
sound formats and verify against the device's reduced manifest. See
[grouped updates](pwa-integration.md#grouped-updates) and
[serving group archive members](pwa-integration.md#serving-group-archive-members-at-the-origin).

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

The deprecated pre-0.47 package subpaths are gone. Use the [canonical paths](../guides/using-game-kit.md#api-namespaces-and-migration) in imports, mocks, CSS and generated references.

`runtime/web/pwa/dom/launch` no longer exports `LAUNCH_RELOAD_KEY`,
`LAUNCH_PROGRESS_KEY`, `legacyRoutingCacheName` or `legacyGroupDatabaseName`.
Use the launch lifecycle and `bootProgress()` for recovery. Version 0.69 removes
the pre-router cache migration.

## Optional install packs in 0.63.0

Added optional `packs` on `precachePlugin`. See
[Install packs](pwa-integration.md#install-packs) for configuration and fallback.

## Refusal admission and Retry press cues in 0.62.1

Pointer refusal runs only when the caller resolves a current action. Configured loading-safe Retry shows a non-ring press cue for fixed or content width, including forced colours.

## Obsolete update offers and local checks in 0.62.0

- A superseded update rejects with `ObsoleteUpdateOfferError` from `runtime/web/pwa/buildContract`. Close only the matching displayed prompt. The error names the version that started the switch. Genuine failures keep the existing error path.
- Local working-tree and release checks share one runner. `make check` requires host Node 24.21.0 or newer. Tests and packaging still run in Docker.

## Update discovery and control options in 0.61.0

- `createLaunch(...).requestUpdateCheck()` asks the existing ordinary discovery scheduler to check after the game's genuine return to Start. Explicit Update now still applies the offered build.
- Standard buttons accept guarded pointer refusal without a keyboard tab stop or an announced reason.
- The configured loading-safe Retry can fit its label with `action.widthPx: "content"`, retaining the caller's padding and height.

## Button state styling in 0.60.2

Standard controls, loading-safe Retry, crash buttons and the crash details summary use face, text or icon changes on keyboard focus, including in forced colours. Persistent borders, hit targets and native activation stay in place. An engine without the required CSS support can use its native focus indicator.

## Update activation and startup recovery in 0.60.1

Update now began revalidating the offered build after saving. Startup storage failures began reaching Loading failed, and Retry rereads startup state. See the [install and update design](../design/install-and-update.md#4-design) for how superseded offers and startup failures are handled.

- Return `{ kind: "pointer-refusal" }` as the availability from `getState` to leave a non-executable button visible and skip keyboard navigation. Supply `onPointerRefusal` for guarded pointer feedback. The renderer does not announce a reason or run the action in that state.

## Required loading status checks in 0.59.1

Fix. In `createRequiredLoading`, a provider `status()` that throws while `retry()` starts no longer escapes `retry()` synchronously or leaves the attempt in flight. That `retry()` returns a promise rejected with the thrown error, the provider is not retried, and the next `retry()` starts a fresh attempt. No game change is needed beyond the version.

## Migration to 0.59.0

Breaking. The page installs and updates the game under one loader, and the service worker only routes. Each game updates its integration.

- `runtime/web/pwa/dom/launch` replaces `startOfflinePlay` (`web/pwa/dom/offlinePlay`) and `UpdateFlow` (`web/pwa/dom/updateReady`), including `launchReady`, `registrationReady`, `retryInstallation`, `offerShown`, `arriveHome`, `setOfferVisible`, `dismissOffer` and `onUpdateShown`. Call `createLaunch(context, { serviceWorkerUrl, soundFormat, onProgress, onFailure, onNetworkPlay, onUpdateReady, onUpdateState, onRequireNewer })` once, with the `context` of a `supported` `prepareBrowserLaunch` result (see [Production startup](pwa-integration.md#production-startup)), and `await run()` before game construction or save access. `"reloading"` means do not start the game. `requireNewer()` keeps its behaviour, and `RequiredUpdateState` moves to `dom/launch`.
- The required `soundFormat` (`string | undefined`) replaces the worker URL's `?sound=<format>` parameter (`web/pwa/serviceWorkerUrl`). Pass the format the page plays, chosen as before, for example the first one an audio element's `canPlayType` accepts. Each build installs, counts in progress and checks for completeness only the sound alternatives whose URL extension is that format, none of a sound without one, plus every other file. The page saves the build's manifest reduced to that choice and records the format with it, so the installer, launch and the router's staged promotion agree. A left-out alternative goes to the network if requested. `undefined` installs every alternative, as a game without sounds passes.
- A site page that does not run the launch, such as `/`, calls `registerRouter(navigator.serviceWorker, serviceWorkerUrl)` from `runtime/web/pwa/dom/launch`. It registers the router (`updateViaCache: "none"`) without installing, so an app installed from that page opens through the router, offline once a launch has installed a build. It resolves `false` where the browser has no service workers or registration fails.
- `onUpdateReady({ version, updateNow, dismiss })` replaces the home-screen offer. It fires once per staged version, on any screen. The game draws its own Update now prompt and pauses play. `updateNow(save)` awaits the game's save, then activates the staged build and reloads with no download. `dismiss()` continues play on the active build, and the next launch applies the update silently.
- `LaunchProgress` (`{ phase, value, receivedBytes, totalBytes }`, one determinate value over the first install and the boot reads) replaces `InstallationState`, `OfflineActivity` and `DownloadProgress` for the first install. Have the boot loader call `launch.bootProgress(done, total)`. After the first install reloads into the router, `run()` reports the carried value at once, so the bar keeps its value until the boot loader's first read. Show Loading failed only from `onFailure({ reason, retry })`, with Retry wired to `retry`. `reason` is `network` or `verification`. Where the device cannot install, `run()` calls the required `onNetworkPlay({ reason })` once and then resolves `"play"`, and the game plays from the network. The `reason` is `unsupported` when the router cannot register and `quota` when storage is full (`NetworkPlayNotice` in `runtime/web/pwa/buildContract`). The game shows its own notice, such as "Playing online because this device could not install the game". The kit renders nothing. Each later launch tries the install again, reusing stored files. Background updates report only `UpdateState` (`idle`, `staging`, `ready` or `failed`) through `onUpdateState`, never Loading failed. A failed one retries while the page stays visible, after 60 s and then twice the previous wait up to 15 minutes.
- The worker entry calls `runServiceWorker(policy)` with no manifest. Delete its `PrecacheManifest` and `GAME_KIT_PRECACHE_MANIFEST` uses. The worker downloads nothing, calls `skipWaiting` and `clients.claim`, serves each window its pinned build, or the active one, and leaves `cache: "no-store"` requests to the network. The installer fetches unhashed files with `no-store` and files under `hashedAssetPrefix` in the default mode, so the HTTP cache or the router may answer them with the same bytes.
- `build/precachePlugin` no longer writes a manifest into the worker. It emits the pointer `/.game-kit/build.json` and one `/.game-kit/manifest-<version>.json` per build. Serve `build.json` with `Cache-Control: no-store`, so no CDN or browser cache keeps it, and each manifest as immutable. Remove the `groups` option.
- Asset group removals include `web/pwa/assetGroups`, `web/pwa/dom/assetGroups`, `web/pwa/precacheGroups`, the group store and the activation barrier. The complete build installs before first play. Boot loads every group behind the one loader.
- Other removals include `web/pwa/updateReady`, `web/pwa/downloadProgress`, `web/pwa/dom/downloadProgress`, `web/pwa/serviceWorkerUrl` (register the plain worker URL and pass the sound format as `createLaunch`'s `soundFormat`), `runtime/web/pwa/precacheManifest` and `build/precacheList`'s `PrecacheManifest`, the old worker's `cachePolicy` helpers (`strategyFor`, `cachedUrlsOf`, `installUrls`, `installPlan`, `digestContentHash`, `precacheFetchOptions`, `cacheNameFor` and `staleCacheNames`), and `precacheFingerprint`'s grouped argument, so it is `precacheFingerprint(policy, contentHashes, byteSizes?, verifiedJsonBodies?)`.
- New paths include `runtime/web/pwa/buildContract`, `build/buildManifest`, `runtime/web/pwa/dom/buildStore` and `runtime/web/pwa/dom/buildInstaller`.
- The first launch on the router finds no active build and installs under the loader. It copies each file an old version cache holds with the manifest's size and SHA-256, then deletes the old version caches, routing records and asset-group database. Saves are unchanged.

## Verified JSON response headers in 0.58.1

Fix. A verified JSON response no longer fails on a header name outside a fixed list, so browser fetches through a CDN that adds `priority` or `server-timing` install. Only `clear-site-data`, `content-disposition`, `content-location`, `content-range`, `refresh` and `set-cookie` fail it, alongside the existing content-type, cache-control, vary, encoding, length, nosniff, redirect and source URL checks. No game change is needed beyond the version.

## Exit availability in 0.58.0

Additive. `runtime/web/pwa/appWindow` exports `canExitApp(createCloseWatcher, host)`, which is true only where the page runs in an installed app's window that a script can close, so a start screen shows Exit only there. It is `runsInAppWindow(host) && !appCannotClose(createCloseWatcher, host)`. Read it as the page loads, and call `exitApp` when Exit is chosen.

## Action font synthesis in 0.51.0

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailureActionTextStyle`, extending the existing text style with optional `synthesis: "none" | "weight"` for `presentation.text.action` only. Explicit values set hardened `font-synthesis` on Retry. Omission preserves inheritance. Replacing an explicit value with omission through `setPresentation` removes the inline synthesis policy. Title/body, unconfigured fallback and legacy layout policies remain unchanged.

The caller still supplies `weight`. Qualify weight and synthesis together on the actual platform because enabling synthesis alone does not guarantee heavier glyphs or a match to another control's font. This option preserves the fixed system font stack, caller CSS size, geometry, palette and independence from game fonts or downloads.

## Configured text paint in 0.50.1

Configured headings and body text use transparent backgrounds over the caller's panel colour. Unconfigured and legacy-layout fallback backgrounds remain unchanged. Public declarations, geometry, typography and input behaviour are unchanged.

## Configured failure presentation in 0.50.0

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailurePresentation` and `LoadingFailureTextStyle`. Pass optional `presentation` to `mountLoadingFailure` to configure the existing hardened fallback. Omission retains the previous native fallback and optional `layout` behaviour. `layout` and `presentation` are mutually exclusive. Invalid configurations fail before DOM mutation. Configurations are captured rather than retaining caller objects. Set `presentation.action.widthPx: "content"` with `LoadingFailurePresentation<"content">` to fit the Retry label, horizontal padding and borders within the panel. Height and centering follow the configured presentation. The default type parameter remains `number` for numeric callers.

All geometry is explicit CSS pixels. The `panel` group supplies `maxWidthPx`, `safeInsetPx`, top/horizontal/bottom padding, title-to-body and body-to-action gaps, border width, bottom lip height and shadow offset. The maximum width is configurable rather than a renderer constant. Mount inside a caller-owned frame with definite dimensions. That frame owns placement and centring. The panel bounds its width and height against that frame and scrolls overflowing content. It neither discovers a game frame nor controls the viewport or loading bar.

The `text` group supplies title, body and action styles, each with `sizePx`, `weight` and unitless `lineHeight`. Configured text uses `system-ui, sans-serif` independently of game scale and needs no font or artwork download. The `action` group supplies explicit `widthPx` and `heightPx`, horizontal/bottom padding, border width and highlight/shade heights. Callers convert their normal logical button size through their own fit exactly once. The renderer adds no CSS height floor, device-pixel multiplier or font shrinking. The `palette` group supplies explicit hex colours for the panel, text, action, action text, border, lip, shadow, highlight and shade. Optional `panel.highlightHeightPx` with `palette.panelHighlight` draws the panel's bevel row as an inset highlight of that height under the top border, painted above the lip and shadow. Give both or neither. Omitting both keeps the panel's shadow unchanged. Configured properties remain hardened against inherited page styles.

A mount with a required `presentation` returns a configured view with `setPresentation(next)`. Use it from the existing fit/resize subscription to update CSS dimensions without replacing the button or resetting retry, state, focus or held-key tracking. Validation completes before updates are applied. Dispose the view and caller subscription with their existing lifecycle. Presentation never controls retry classification, required-resource priority, activation, saves, mute or modal policy.

Explicit button dimensions and fixed text can conflict in very short frames. Scrolling does not prove that a label fits its button. Callers must qualify their supported frames and report an unavailable fit rather than silently changing the requested font or dimensions. Existing Retry singleflight, keyboard containment, exact messages and native accessibility remain unchanged.

## Retry keyboard containment in 0.49.1

The loading-failure Retry button contains Enter and Space keydown, keypress and keyup propagation while preserving native button activation and accessibility. Matching repeats and release redirected to a neutral document target after disabling or blurring Retry remain contained while focus stays on Retry or neutral. New presses at neutral targets, other controls, focus transfer and window blur end that tracking. Disposal removes its listeners.

This prevents activation keys from reaching window bubble handlers. Ancestor capture listeners still observe them, and redirected events can reach document or earlier ancestor bubble observers. It does not trap focus, suppress unrelated controls, prevent native defaults, synthesize clicks or change retry singleflight, layout, state or caller policy. No API change is required.

## Additive layout controls in 0.48.0

`runtime/ui/layoutTree` exports `LayoutColumnSizing` and `LayoutColumnTrack`. Only `columns` nodes accept optional `sizing`. The `{ mode: "equal" }` mode allocates equal fractions of the bounded content width. `{ mode: "intrinsic" }` keeps content-sized tracks. `{ mode: "tracks", tracks }` assigns one descriptor per child. Descriptors are `{ kind: "fraction" }`, `{ kind: "intrinsic" }` or `{ kind: "fixed", size }`. Fraction tracks share the space remaining after fixed/intrinsic tracks, gaps and padding. Fixed sizes use the existing logical `--ui-unit` scaling. Use explicit intrinsic/fixed descriptors for divider tracks. The renderer never infers a component role. Omission preserves legacy sizing. Invalid configurations fail before DOM mutation. Actual measurements still determine overflow or unavailable results. Track selection does not guarantee fit.

`runtime/web/progress/dom/loadingFailure` exports `LoadingFailureLayout`. Pass optional `layout` with all fields `{ actionAlign: "start" | "center" | "end", gapPx, minActionSizePx, paddingPx }` alongside `onRetry` to `mountLoadingFailure`. Numeric values are finite, nonnegative CSS pixels captured at mount. Callers convert game units. The fallback applies those values through its hardened CSSOM styles, keeps the native button label centred, and remains independent of game fonts and art. Minimum dimensions do not guarantee viewport fit. Omission retains native defaults. Shared text, single-flight Retry, stale-event guards and disposal are unchanged.

## Migration to 0.46.0

`load/phaser/watchLoader` now records and retries standalone `xml` files through the existing `retryMode` and `retryFailures` API. Install the watch before queueing XML so its ADD event captures the original base URL and resolved XHR settings. Resolved keys and URL paths are retained without duplicating the loader prefix or path. Current loader settings are restored after queueing and native dispatch. XML queued before the watch remains non-retryable because its original context is unavailable.

XML parsing failures are recorded before native loader completion, independently of network failures and without counting the same file twice in progress. Temporary native bindings are restored on settlement or disposal. The caller still selects required loads. Optional automatic retry rounds and multi-file captures remain unchanged. No game font or asset key is defined by the kit.

## Migration to 0.45.0

`watchLoader` accepts optional `retryMode(failure)` returning `"automatic"` or `"manual"`. The default preserves automatic retry rounds. The classifier receives a logical `LoadFailure` with the loader method, resolved key, captured configuration and first failed URL, with an entire captured multi-file load classified together. The caller identifies required UI or other active-view dependencies. The kit contains no required asset list. Automatic scheduling and dispatch exclude manual failures while retaining their records and original multi-file arguments. Optional failures retain their existing timers and round counts.

`watch.retryFailures(select)` explicitly requeues only currently recorded selected failures. Successful loads remain intact. Calls share an active flight and add newly selected logical loads without duplicating those already queued. Manual retries do not consume automatic retry rounds. The promise settles when the loader run completes or the watch is disposed. Settlement is not a success result. Recheck the caller's required-resource status before continuing. Use the existing `waitFor(label)` and progress handle for the same loading bar. Keep one watch for its scene lifecycle rather than disposing it to suppress a subset of retries.

`createLoadingAttempts` reruns the supplied callback. It does not clear native ES module maps or reload the document. A browser may retain a failed module record, and module evaluation failures are not repaired by importing that record again. Keep fallible application startup in an explicit attempt-owned function, with cleanup registered before acquiring mutable resources. Same-page recovery requires a genuinely repeatable provider operation. A fresh-document restart is a separate caller-owned lifecycle decision, including launch, activation and save guards.

## Migration to 0.44.0

`gameViteConfig` passes one captured `BuildMetadata` as the third `plugins(modules, repoPath, metadata)` argument and defines `__BUILD_ID__` alongside the existing `__COMMIT__`. Pass `metadata.buildId` into `precachePlugin({ buildId, ... })`. Do not independently shorten or derive it. `web/build/buildVersion` exports the pure `buildMetadata` and `isBuildId` helpers. `web/build/vite/gitHead` exports `gitBuildMetadata` for custom Vite configuration. With `buildId`, the plugin validates that the captured ID still matches clean Git source and the app define, so development, dirty source, missing Git identity or a mismatching CI commit fails the build. Without it the manifest records `UNKNOWN_BUILD_ID`.

## Migration to 0.43.0

Added required-file attempts, explicit Retry and a shared loading-failure alert. See [Required loading failures](loading.md#required-loading-failures).

## Migration to 0.41.0

Additive typed composition through `ui/layoutTree`, `web/ui/dom/layoutTree` and its opt-in `layoutTree.css`. Supply actual production component factories and use the same tree, ports, fonts and CSS for runtime and mocks. Stable keys retain DOM identity and focus across updates. Physical measurements are caller-owned. Absent or incomplete measurements report `unavailable`, never fit. The renderer reports overflow without shrinking, clipping or adding scrolling. Game navigation, labels, actions and approval remain caller-owned.

## Migration to 0.40.0

Additive shared controls. `ui/buttonLayout` and `web/ui/dom/buttonLayout` share caller-authored button geometry between Art mocks and runtime controls. Import `web/ui/dom/controls.css` explicitly. Define one named token record for both renderers. Art tooling remains structural and dependency-cycle-free. Existing `ui.css` spacing and defaults are unchanged. `ui/controlPresentation` and `web/ui/dom/controlPresentation` provide availability guards, one inherited page/modal divider and a decorative disclosure mark. Import their `controlPresentation.css` explicitly.

Use external top alignment for Buy/Details beside multiline copy, explicit centre alignment for compact quantity rows, and a common height and authored font line box/baseline for footer controls. Always centre the single foreground label inside its button face. Games retain fonts, palettes, faces, labels and navigation content.

## Migration to 0.39.0

- In `save/versionedSave`, any finite numeric header above `format.version` returns `"newer"` before integer validation, migration or decoding, including higher fractional and unsafe integer values. Lower malformed headers remain `"corrupt"`. The fresh save returned for `"newer"` is a placeholder. Keep play blocked and preserve the stored save until a compatible version can load it.
- `save/saveStore`. `SaveStore` gains `blockWrites(reason: string): void`. Add it to store test doubles. The first reason permanently fences later save and corrupt-backup writes for that store instance, including after a pending read or an encoder callback. Later reads remain available and never rearm writes. A fenced `save()` returns `"unavailable"`. Use this when another store or a session guard requires writes to stop. A backend write already entered may finish and report its actual result, including `"saved"`. The fence does not cancel or roll back that write.

## Migration to 0.36.0

Additive. `web/ui/dom/focusModality` is new, and `web/ui/dom/modalLayer` and `web/crash/dom/crashScreen` move the focus through its `focusTarget`, so script focus on a touch screen no longer shows a focus ring while keyboard players keep theirs. Optionally call `trackInputModality(document)` at boot and replace each of the game's own screen-open `.focus()` calls with `focusTarget(element)`.

## Migration to 0.35.0

- `view/phaser/tilemapCull` is new. Optionally replace a local tilemap cull with `cullToCameraView(layer)`, which culls an orthogonal layer to the area the camera shows for its own origin.

## Migration to 0.32.0

Additive. `load/phaser/watchLoader` retries multi-file loads, such as bitmap fonts and Aseprite sheets, as a whole in the same silent rounds as single files, and gives each of their files the loader's timeout. `MULTI_FILE_METHODS` lists the loader methods it covers, `MultiFileMethod` names one, and `RetryableType` adds them. Delete any local retry of fonts or sheets, and queue multi-file loads through the loader's methods after creating the watch.

## Migration to 0.31.0

Each game updates its integration.

- `ui/hitAreas` adds `HIT_RULE`, the shared press-area rule (`minTarget` 48). Replace a game-local rule or fixed press size with it.
- Loading. Pass `load/loaderConfig`'s `LOADER_CONFIG` as the Phaser game config's `loader`. In every scene that loads, call `load/phaser/watchLoader`'s `watchLoader({ console, progress: foreground, timer: window }, this)` in `init` or `preload` each time the scene starts, and mark each load the player waits for with `waitFor(label)` (boot, entering a level or area) instead of reporting Phaser's `progress` fraction or a byte share to the bar. Drop the game's own `loaderror` logging. The watch logs and retries failed files.
- Loading bar. Make the foreground loads and a forced update two progress states, and have the bar follow `createLayeredProgress(window, timing, { background, foreground })` (`progressState`) instead of either state. A bar that existed only while something loaded stays mounted and hidden while idle.
- Delete every local copy these replace. Loader timeout and retry settings, loader trackers, failed-file logging and retry, and foreground and background bar schedulers.

## Migration to 0.29.0

Additive. `ProgressBarStyle` takes optional `frameAlpha` and `trackAlpha` in [0, 1], default 1, for a translucent or invisible frame and track behind opaque fills. `checkProgressBarStyle` throws a `RangeError` outside that range. A finished measured bar can fade out after its full hold. Pass `fadeMs` as `createProgressDisplay(fullMs, fadeMs)` in Phaser or in the DOM bar's `timing`, which writes `--progress-bar-fade`. Existing calls are unchanged. Replace a game-local fade or alpha on the loading bar with these, for example `{ border: 1, fills: [0xead4aa], frame: 0, frameAlpha: 0, track: 0x181425, trackAlpha: 0.6 }` with `{ cycleMs, fadeMs: 150, fullMs: 250, segment: 0.3 }`. Pre-script markup sets the same `--progress-bar-fade` on the `.progress-bar` and paints its own translucent colours.

## Migration to 0.28.0

Additive. A DOM progress bar created with `timing` lands its travelling segment on whole pixels of the frame's units, as the Phaser bar does. The script writes `--progress-bar-segment-width` and `--progress-bar-steps` (`progressBarPixelProperties`), and `progressBar.css` steps the travel one pixel at a time. Remove game rules that round the segment or step its travel, such as a `steps()` timing on `.progress-bar-band > *` and the step count property and segment rounding that feed it, and pass the motion's own `segment`. Pre-script markup keeps its continuous travel unless its static CSS sets the same two properties on the `.progress-bar` from `progressBarPixelProperties(style, motion, frame)`.

## Migration to 0.27.0

Additive. `ui/spacing` adds `STACK_BUTTON_GAP` (8 base px) between standard buttons stacked vertically, and `ui.css` defines `--ui-stack-button-gap` on `.ui-layer`. Small buttons take `SMALL_BUTTON_GAP` in any direction, stacks included. Replace a game-local stack gap with the constant, or with `var(--ui-stack-button-gap)` inside `.ui-layer`.

## Migration to 0.26.0

- The new `ui/spacing` exports `BUTTON_GAP` (16 base px) between standard buttons side by side and `SMALL_BUTTON_GAP` (24) between small buttons. Use `--ui-button-gap` and `--ui-small-button-gap` on `.ui-layer`. Replace each game-local gap between buttons with the constants, or with the properties inside `.ui-layer`. They are undefined outside it.

## Migration to 0.25.0

Loading bars show nothing while idle, a measured bar that fills to full and then disappears, and an indeterminate segment that travels left to right until the work finishes. The static centred segment is removed. Each game updates its integration.

- `progress`. `progressBarLayout` takes a `number`. A nonfinite share lays out empty. A build-time layout of `undefined`, such as a pre-script strip, becomes the DOM bar's markup with its bands at `progressBarLayout(style, frame, 1).fills`, animated by `progressBar.css`. Match the script's markup. The track is the bar's first child, then one `.progress-bar-band` per fill, each holding one segment. The script sets `overflow: hidden` on each band, so pre-script CSS must clip the bands itself.
- `progress/phaser/drawProgressBar`. `drawProgressBar` takes a `number` and stays for measured meters. A loading bar keeps a `createProgressDisplay(fullMs)` that its progress state reports to (`state.subscribe(display.report)`), and each frame clears its graphics and calls `drawProgressDisplay(graphics, style, motion, frame, display.at(time))` with the scene clock and a `ProgressMotion`.
- For `web/progress/dom/progressBar`, import `@andornaut/game-kit/runtime/web/progress/dom/progressBar.css`. Without it a pending bar draws its segment across the whole track. Existing `createDomProgressBar(parent, style, frame)` and `update(value)` calls are unchanged and travel while pending. Pass `timing` to set the motion and hold, and subscribe `report` in place of toggling visibility to hide the bar while idle and fill it on a measured finish. The fill shows only when the last active report was measured. Reporting `undefined` before the finish hides the bar at once. To fill a measured load and then wait on work of unknown length, finish the measured operation at 1 and begin a separate one for the rest.

## Migration to 0.21.0

The install offer shows in every browser until the game is installed. Use the browser's prompt when available, or show that browser's install steps.

- `web/pwa/installState`. `MenuInstallBrowser` and `menuInstallBrowser` are replaced by `InstallStepsKind` and `installStepsKind(userAgent, maxTouchPoints)`, and `InstallFacts` drops `menuBrowser`. `InstallState` is `installed`, `prompt` or `steps`. `unsupported` and `menuSteps` are removed, and `offersInstall` is true in every state but `installed`.
- `web/pwa/dom/installFlow`. `InstallFlow.menuBrowser` is renamed `stepsKind` and is always set. `install()` returns `accepted`, `dismissed` or `steps`. `menuSteps` and `unavailable` are removed, and `steps` (no prompt held, or it failed to show) means show the steps for `stepsKind`.
- In `web/pwa/dom/installButton`, each steps dialog section is marked `data-steps="<kind>"` instead of `data-browser`.
- Supply steps for all eight kinds, typed `Record<InstallStepsKind, ...>` to cover `chromiumAndroid`, `chromiumDesktop`, `firefoxAndroid`, `firefoxDesktop`, `ios`, `other`, `safariMac` and `samsungInternet`. A dialog without a kind's section shows its `other` section.

## Migration to 0.19.0

- In `testing/phaser/sceneStub`, an override member that is an object literal now merges into the stub's member one level deep instead of replacing it, so `{ scene: { get } }` keeps the other `scene` spies. A class instance, function, array or emitter still replaces the member. To replace a whole member with a literal, assign it after construction. For example, `Object.assign(stub, { scene: { get } })`. The literal is copied. A test that changes a value later, such as advancing `time.now`, changes the stub's member (`const { time } = stub`), not its own literal.
- `testing/phaser/sceneStub`. `add` holds game object factories instead of starting empty, and `textures.list` holds `StubTexture` values, which tests seed without a cast.
- In `terrain/movementMap`, equal-seconds arrivals over one edge now resolve by the documented rule (the arrival generated first wins) instead of by heap layout, so a path may differ from 0.18.0 only where two routes take exactly the same time.
