# @andornaut/game-kit

Game-agnostic TypeScript helpers for Phaser games: arrays, maps, records, numbers, seeded random, rects, line wrapping, branded units, a fixed-step clock, integer zoom, bitmap-font text fitting, a versioned save store, a crash screen, an offline service worker with update and install handling, security headers and the build label.

## Importing

A game imports a module by its path under `src/`, without the extension, as `@andornaut/game-kit/<path>`:

```ts
import { seededRandom } from "@andornaut/game-kit/random";
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
```

A game holds this copy in `vendor/game-kit/` and maps `@andornaut/game-kit/*` to `vendor/game-kit/src/*` in its `tsconfig.json` `paths` (read by tsc and tsx) and its Vite `resolve.alias` (read by Vite and Vitest). Modules inside the kit import each other by relative path. `KIT_COMMIT`, beside this file in a game's copy, names the game-kit commit it was copied from; the copy is never edited by hand.

## Layout

- `src/`: pure helpers, with no game knowledge
- `src/art/`: lossless WebP for a game's build tools, in Node (`art/webp.ts`): `encodeLosslessWebp` (libwebp's method 6 at quality 95, colour under clear alpha kept, the same bytes on every host) and `decodeWebp`, with `webpDecodesTo` for a test that a WebP holds its source's exact pixels. It needs `@jsquash/webp` 1.5.0, which the game pins in its own `package.json`: the vendored copy has no `node_modules`, so the import resolves to the game's
- `src/build/`: the build's version and commit label. `build/buildInfo.d.ts` declares the `__APP_VERSION__` and `__COMMIT__` globals, which the game's bundler defines (`shortCommit` and `gitHead` in `build/buildVersion.ts` give the commit). A production build's Phaser (`build/phaserBuild.ts`, built by `build/vite/phaserBuildPlugin.ts`) leaves out the namespaces a game names and sets Phaser's feature flags from its overrides; `build/phaserUses.ts`'s `phaserBuildProblems` lists what a game uses that its build leaves out (omitted namespaces, and what a feature flag set false removes, such as the sound manager and audio loading under `FEATURE_SOUND: false`), for a test to expect `[]`
- `src/clock/`: the fixed-step clock, and a frame rate cap for when the game is not in play (`clock/frameCap.ts`), which `clock/phaser/capFrameRate.ts` applies to Phaser's loop given a `playing` predicate
- `src/crash/`: the crash screen, plain HTML over the page on the first uncaught error or unhandled rejection, ignoring extension, cross-origin (`Script error.`) and ResizeObserver-loop errors. `crash/crashModel.ts` decides which errors count and what the screen says, without the DOM; `crash/crashScreen.ts` draws it in the game's words and colours, with the build label, message, stack and a Copy button in dev builds. The game imports `crash/crash.css` beside it, since a page whose CSP has no `'unsafe-inline'` refuses a `<style>` a script adds
- `src/headers/`: a Cloudflare `_headers` file with a Content-Security-Policy per page rule. `headers/securityHeaders.ts` finds each page's inline `<script>` and `<style>` blocks, hashes them and renders the file; `headers/vite/securityHeadersPlugin.ts` writes it at build time from the game's base directives, page rules and file rules, and fails the build for a page in no rule or two, or an unhashed file under the hashed asset path
- `src/pwa/`: the installed web app. `pwa/cachePolicy.ts` holds the service worker's caching rules for a game's `CachePolicy` (cache name prefix, hashed asset prefix, URLs fetched network-first); `pwa/serviceWorker.ts` is the worker, which a game's worker entry runs with its policy and the precache manifest, and whose install copies hashed files an earlier version stored rather than fetching them; `pwa/vite/precachePlugin.ts` builds that entry to `sw.js` with the manifest written in (the page, what it loads and links, the web app manifest's icons, and hashed files the game names, sounds by format). `pwa/updateReady.ts` switches to a newer version before play or offers it on the home screen after, holding only the first screen and the save while the game loads, and `registerWhenDue` registers the worker at once on a controlled page and on a first visit's first arrival home; `pwa/installFlow.ts` and `pwa/installState.ts` hold the browser's install prompt and say how the game can be installed; `pwa/serviceWorkerUrl.ts` names the sound format on the worker's URL; `pwa/wakeLock.ts` keeps the screen on while the game asks and the page is visible; `pwa/storagePersistence.ts` asks the installed app's browser to keep the site's storage
- `src/save/`: a versioned save store. `save/versionedSave.ts` reads a save stored as JSON with an integer `version`, runs the game's migrations up to its current version and hands the result to the game's `SaveFormat` to decode; a later version's save loads as `newer` and anything unreadable as `corrupt`. `save/saveStore.ts` keeps one save in a `SaveStorage` under the game's keys: it backs a corrupt save up before the next write replaces it, and stops writing for the session once storage fails at load or a newer save is stored. `save/storage.ts` adapts `localStorage` (`localSaveStorage`) and holds `memoryStorage` for tests. The game owns its save's shape, schema, validation and migrations
- `src/text/`: bitmap-font text fitting. `text/bitmapFont.ts` reads an XML BMFont (`.fnt`) file into a `BitmapFont` and measures it: its rows (`fontMetrics`) and a line's ink width at a scale (`inkWidth`), laid out as Phaser's `BitmapText` lays it out. `text/textFit.ts` sets text at one fixed size, wrapped at spaces within a room on up to a style's lines (`fittingText`), with any measure; `bitmapMeasure` is a bitmap font's. `text/overflow.ts` lists every text in a table of roles that overflows its room, for a test to expect `[]`. `text/phaser/phaserBitmapFont.ts` reads a loaded font from Phaser's cache into the same `BitmapFont`, so runtime and tests measure alike
- `src/view/`: the integer zoom, and where the canvas sits in its space (`view/canvasPlacement.ts`: centred, or at the top of a portrait viewport); `view/phaser/` keeps the game canvas at that zoom and placement

## Boundary

The kit never imports a game's code: anything game-specific, such as a screen size or a step length, is passed in. It holds no player text. Pure code sits at each folder's root and runs in unit tests without a renderer; only `phaser/` folders import Phaser. Build plugins sit in `vite/` folders, the only ones that import Vite. The game-kit repository's ESLint config enforces the first and the last two.

## Licence

[MIT](./LICENSE). The game that holds this copy keeps its own licence.
