# game-kit

The home of `@andornaut/game-kit`, game-agnostic TypeScript helpers for Phaser games. The kit itself is in [`kit/`](kit/README.md); this level holds its gate and the script that copies it into a game.

## Gate

Requires Node 24 (`.nvmrc`). Run `npm install`, then:

| Command          | Does                                    |
| ---------------- | --------------------------------------- |
| `npm run check`  | Type check `kit/src/` with tsc          |
| `npm run format` | Rewrite files with Prettier and ESLint  |
| `npm run lint`   | Prettier check, ESLint and markdownlint |
| `npm test`       | Run the kit's unit tests with Vitest    |

ESLint holds the kit's boundary: `kit/src/` imports nothing from a game and its own modules by relative path, only `phaser/` folders import Phaser, and only `vite/` folders import Vite.

## Including the kit in a game

Each game holds a committed copy in `vendor/game-kit/`, which `scripts/sync-into.sh` writes:

```bash
scripts/sync-into.sh <game repository or worktree>
scripts/sync-into.sh --check <game repository or worktree>
```

The first copies `kit/` as committed at this repository's HEAD into `<game>/vendor/game-kit/`, removing files there the kit no longer has, and writes the commit to `vendor/game-kit/KIT_COMMIT`. `--check` exits 1 when the game's copy differs from the kit at the commit its `KIT_COMMIT` names.

The game then:

- maps `@andornaut/game-kit/*` to `vendor/game-kit/src/*` in its `tsconfig.json` `paths` (tsc and tsx) and its Vite `resolve.alias` (Vite and Vitest), and includes `vendor/game-kit/src` in tsc and `vendor/game-kit/src/**/*.test.ts` in Vitest
- exports `gameViteConfig` (`kit/src/build/vite/gameConfig.ts`) from `vite.config.ts`, imported by its path under `vendor/game-kit/`: Vite bundles the config without its own alias, so the config imports no module that uses the alias, and `gameViteConfig` loads the game's plugins from its config module through `runnerImport` from `vite`, given the alias
- leaves `vendor/` out of its Prettier, ESLint and markdownlint runs: the copy is linted here
- never edits the copy by hand

A kit change lands as a commit here, then a sync commit in each game that takes it.

## Licence

[MIT](kit/LICENSE).
