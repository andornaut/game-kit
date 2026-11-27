# PWA integration

Configure production startup, offline build output, update transport and origin serving.

[Reference](README.md)

## Production startup

At production startup, call `prepareBrowserLaunch({ parent, onUnsupported }, policy)`
from `runtime/web/pwa/dom/launch` before creating the installer or game. It
requires Service Worker, Cache Storage and `DecompressionStream`. With a
`supported` result, pass its context to `createLaunch`. With an `unsupported`
result, the shared error is already visible and game startup stops. The callback
stops the caller's existing loading progress before the error is shown. The
returned `failure` view owns its teardown. Supply `failure.presentation` or
`failure.layout` to fit the existing game frame. The capability error has no
Retry action. Recoverable failures still use the installer's Retry.

## Build output

`build/precachePlugin` builds the worker entry through Vite's isolated worker pipeline as one self-contained classic script, which embeds no manifest. Shared page modules cannot split it into ESM chunks, and the build rejects worker imports or additional emitted files. Games keep classic registration through `createLaunch`.

The plugin also writes the build's manifest at `/.game-kit/manifest-<version>.json` (`buildContract`'s `buildManifestUrl`) and the pointer at `/.game-kit/build.json` (`BUILD_POINTER_URL`). The manifest lists every file the complete build needs offline under the URL the page requests, with its full SHA-256 and exact byte size, including the page, the build output it loads, the public files it links, the web app manifest's icons and the files `hashedFiles` names, every sound alternative included. Each alternative's URL extension names its format, and the page installs only the alternatives in its `soundFormat`. It also records each sound's alternatives, the `boot` files the game reads after install and any verified JSON families. The version changes with any listed file's content and with the build ID, sounds or boot files. The pointer names the version, its build ID and its manifest URL. `build/buildManifest` constructs and strictly validates both. The page and the router read them with checks that ignore fields a later kit version adds.

## Platform Back and confirmed exit

Create one page-level guard with `createBackNavigationGuard` from
`@andornaut/game-kit/runtime/web/pwa/dom/backNavigation`. Pass the actual window `history`,
the window as timer and event target, the game's `stateKey`, and the existing `onBack` route.
Use `backCloseWatcher(navigator.userAgent, browserCloseWatcher())` to select the watcher.
`backCloseWatcher` is in `@andornaut/game-kit/runtime/web/pwa/backNavigation`.

Call `setEnabled(true)` while the game owns platform Back. Keep the guard enabled while the
confirmation is open and after Cancel. Route `onBack` through existing nested dismissal,
active play and Start rules. Keep separate Escape and in-game controls on their existing paths.

Use `canLeave()` for the platform confirmation's Exit availability. On confirmation, call
`await leave()` once. GameKit releases its current guard entry and performs one known
browser traversal or a supported one-entry app close. When it returns `false`, keep the
current screen and return to its normal input routing. `dispose()` releases the page-level
binding when the owner ends. A browser with no usable interception retains its own handling.
History interception can require trusted input before the first Back. Existing Firefox
Android installed-app support limits apply.

## Install packs

Set `packs: { maxBytes }` on `precachePlugin` to batch small assets without changing their logical URLs. See the
[install and update design](../design/install-and-update.md#4-design) for option limits, fallback and
HTTP transfer qualification.

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
worker that supports the archive format. Existing in-session consent, cold-launch activation and required-save
recovery apply to complete archives.

## Grouped updates

`precachePlugin({ updateGroup, ...options })` assigns each discovered file to
one group. `updateGroup(url)` returns a stable group name for the canonical
request URL. Keep frequently changed files separate from stable assets. Each
group has its own SHA-256 and is capped at 24 MiB, including its index.

Serve the deterministic gzip at `buildGroupUrl(group)` as emitted. The
[install and update design](../design/install-and-update.md#4-design) covers group transport,
verification and the HTTP representation shared with install packs.

An unchanged version skips staging. For a changed version, the page reuses
verified groups from earlier builds and downloads missing groups one at a time.
The router serves the pinned version's files from the groups. A complete build
still has one activation, and interrupted staging preserves the active build.
First install can use the current build’s ordinary files or install packs.
Grouped staging requires a controller that supports group archives.

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

An installed build starts while the regular version check runs. If the
deployed build is already active and is missing audio for the device's format,
the same check can recover those groups when the controlling worker supports
repair. It reuses shared groups by digest and verifies the selected groups
and active and staged records before sealing. The router can serve recovered
audio alongside its pinned snapshot for the same version. Play can continue
without unavailable sounds. The old groups stay stored until build reclamation.

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

## Verified JSON body reuse

`build/precachePlugin` accepts optional `verifiedJsonBodies(files)`, selecting explicit URL families from complete final emitted discovery. The URL-array form asserts public, URL-independent UTF-8 JSON with no per-URL response semantics. The plugin parses each body, compares exact final bytes and records each family's full SHA-256, byte size and URLs in the manifest's `verifiedJsonBodies`. Omission selects no families. Family metadata changes the version.

The page installer and the router apply the same response rules (`dom/verifiedJsonSource`). Family requests omit credentials and reject redirects. A network response must be status 200 from the exact requested same-origin URL, with JSON MIME and UTF-8 or no charset. It fails on `clear-site-data`, `content-disposition`, `content-location`, `content-range`, `refresh` or `set-cookie`, a `private` or `no-store` directive, a Vary other than `accept-encoding`, a length that differs from an identity body, an encoding other than identity, gzip, br or deflate, or MIME protection other than `nosniff`. Any other header, such as a CDN's `priority` or `server-timing` or HTTP/1.1 `connection` and `keep-alive`, carries no body semantics and is ignored. A stored entry needs no source URL. Its `x-game-kit-sha256` header, set after verification, and a JSON content type suffice, and any other headers it carries must pass the same checks. The router hashes a stored family body in full before it serves it, and refetches it otherwise. Qualify the deployment's response headers before opting in.

### JSON-data response profile

A family may opt into `{ urls, responseProfile: "fetch-json-data-v1" }` instead of the URL array. Use this only for public JSON interpreted as data without dependencies on its response URL, per-URL headers or relative body URLs. The profile also accepts browser-decoded `zstd`, and its metadata changes the version.

The plugin rejects `fetch-json-data-v1` with `updateGroup` or `wholeBuild`. Use the URL-array form with archives only for families that meet its URL-independent response contract. Switch to per-file updates to keep the profile.

The router answers an exact canonical same-origin GET data request (empty destination, nonnavigation mode, no Range or If-Range header) for a profile URL with the verified body and only `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff`. Navigation and every other request context for a profile URL get that URL's own original response from the network, never the body alias. A profile URL with a query or another noncanonical form is refused. This mechanism provides neither parsed-object caching nor a download-time guarantee.
