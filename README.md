# game-kit

The home of `@andornaut/game-kit`, game-independent TypeScript mechanisms, browser and Phaser adapters, and build tools. The kit itself is in [`kit/`](kit/README.md); this level holds its gate and the script that copies it into a game.

## Gate

Run the isolated gate from the repository root:

```bash
bash scripts/check.sh
```

Requires Bash, Git, Docker with a running daemon, and standard Linux coreutils, awk and uptime. No host Node or npm installation is needed. Keep the checkout unchanged during the run and start below one-minute load 24.

The script uses Node 24.21.0 with at most four CPUs and four Vitest workers. An installation container populates the repository-local `.claude/npm-cache`; a second container runs type checking, lint and tests sequentially without network access. The checkout is read-only; only scratch space and the npm cache are writable. CI runs the same script. `npm run verify` invokes it when host npm is available.

The underlying commands remain available inside the container:

| Command                      | Does                                    |
| ---------------------------- | --------------------------------------- |
| `npm run check`              | Type check `kit/src/` with tsc          |
| `npm run lint`               | Check Prettier, ESLint and markdownlint |
| `npm test -- --maxWorkers=4` | Run the kit's unit tests                |

`npm run format` rewrites files with Prettier and ESLint and requires a writable checkout.

ESLint enforces relative internal imports and prevents game imports. Only `phaser/` folders import Phaser, and only `vite/` folders import Vite. Pure mechanisms, DOM adapters and Node tooling are identified in the [module reference](kit/README.md#modules-and-environments).

## Including the kit in a game

This is exact-commit source vendoring, not a registry installation. The copied [module reference](kit/README.md) lists environments, external dependencies and integration contracts; [kit/package.json](kit/package.json) records supported peer versions. Install only the dependencies needed by imported modules, or all applicable peers when checking the entire copied source and tests.

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
