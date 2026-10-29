# @andornaut/game-kit

Game-agnostic TypeScript helpers for Phaser games: arrays, maps, records, numbers, seeded random, rects, line wrapping, branded units, a fixed-step clock, integer zoom and the build label.

## Importing

A game imports a module by its path under `src/`, without the extension, as `@andornaut/game-kit/<path>`:

```ts
import { seededRandom } from "@andornaut/game-kit/random";
import { frameSteps } from "@andornaut/game-kit/clock/fixedStep";
```

The game maps `@andornaut/game-kit/*` to `packages/game-kit/src/*` in its `tsconfig.json` `paths` (read by tsc and tsx) and its Vite `resolve.alias` (read by Vite and Vitest). Modules inside the kit import each other by relative path.

## Layout

- `src/`: pure helpers, with no game knowledge
- `src/build/`: the build's version and commit label. `build/buildInfo.d.ts` declares the `__APP_VERSION__` and `__COMMIT__` globals, which the game's bundler defines (`shortCommit` and `gitHead` in `build/buildVersion.ts` give the commit)
- `src/clock/`: the fixed-step clock
- `src/view/`: the integer zoom; `view/phaser/` keeps the game canvas at it

## Boundary

The kit never imports a game's code: anything game-specific, such as a screen size or a step length, is passed in. It holds no player text. Pure code sits at each folder's root and runs in unit tests without a renderer; only `phaser/` folders import Phaser. The game's ESLint config enforces the first and the last.

## Licence

[MIT](./LICENSE). The game that holds this copy keeps its own licence.
