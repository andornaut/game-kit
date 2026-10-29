# @andornaut/game-kit

Game-agnostic TypeScript helpers for Phaser games: arrays, maps, records, numbers, seeded random, rects, line wrapping, branded units, a fixed-step clock, integer zoom, bitmap-font text fitting and the build label.

## Importing

A game imports a module by its path under `src/`, without the extension, as `@andornaut/game-kit/<path>`:

```ts
import { seededRandom } from "@andornaut/game-kit/random";
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
```

A game holds this copy in `vendor/game-kit/` and maps `@andornaut/game-kit/*` to `vendor/game-kit/src/*` in its `tsconfig.json` `paths` (read by tsc and tsx) and its Vite `resolve.alias` (read by Vite and Vitest). Modules inside the kit import each other by relative path. `KIT_COMMIT`, beside this file in a game's copy, names the game-kit commit it was copied from; the copy is never edited by hand.

## Layout

- `src/`: pure helpers, with no game knowledge
- `src/build/`: the build's version and commit label. `build/buildInfo.d.ts` declares the `__APP_VERSION__` and `__COMMIT__` globals, which the game's bundler defines (`shortCommit` and `gitHead` in `build/buildVersion.ts` give the commit)
- `src/clock/`: the fixed-step clock
- `src/text/`: bitmap-font text fitting. `text/bitmapFont.ts` reads an XML BMFont (`.fnt`) file into a `BitmapFont` and measures it: its rows (`fontMetrics`) and a line's ink width at a scale (`inkWidth`), laid out as Phaser's `BitmapText` lays it out. `text/textFit.ts` sets text at one fixed size, wrapped at spaces within a room on up to a style's lines (`fittingText`), with any measure; `bitmapMeasure` is a bitmap font's. `text/overflow.ts` lists every text in a table of roles that overflows its room, for a test to expect `[]`. `text/phaser/phaserBitmapFont.ts` reads a loaded font from Phaser's cache into the same `BitmapFont`, so runtime and tests measure alike
- `src/view/`: the integer zoom; `view/phaser/` keeps the game canvas at it

## Boundary

The kit never imports a game's code: anything game-specific, such as a screen size or a step length, is passed in. It holds no player text. Pure code sits at each folder's root and runs in unit tests without a renderer; only `phaser/` folders import Phaser. The game-kit repository's ESLint config enforces the first and the last.

## Licence

[MIT](./LICENSE). The game that holds this copy keeps its own licence.
