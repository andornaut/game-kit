# Using GameKit

Install the compiled package, choose public imports and check the version policy.

[Documentation index](README.md)

## Importing

Import individual public modules without an extension.

```ts
import { frameSteps } from "@andornaut/game-kit/runtime/clock/fixedStep";
import { seededRandom } from "@andornaut/game-kit/runtime/random";
import { memoryStorage, type SaveStorage } from "@andornaut/game-kit/runtime/save/storage";
```

Choose a version from [GitHub releases](https://github.com/andornaut/game-kit/releases). Install the compiled archive by its versioned URL, `https://github.com/andornaut/game-kit/releases/download/v<version>/game-kit-<version>.tgz`, and commit the lockfile with its URL and integrity. For archive contents and source provenance, see [Release artifacts and consumer proof](development.md#release-artifacts-and-consumer-proof).

Pure imports need no runtime peers. Phaser, TypeScript, Vite and Vitest are optional peers. The `phaser/` adapters need the game's `phaser`, Vite plugins its `vite`, `build/phaserUses` its `typescript` and `build/gameConfig` its `vitest`. Every `phaser/` adapter may import Phaser at runtime, so a game test that mocks it with `vi.mock("phaser")` must inline the kit with `test.server.deps.inline: ["@andornaut/game-kit"]`.

## API namespaces and migration

Version 0.47.0 introduced canonical imports using `@andornaut/game-kit/runtime/...`, `@andornaut/game-kit/build/...` or `@andornaut/game-kit/test/...`. The remaining pre-0.47 aliases have been retired. Every public subpath is explicit in `package.json`. The `@andornaut/game-kit/package.json` metadata export remains available.

| Namespace  | Use                                                                                                             | Dependency direction                          |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `runtime/` | Game and website runtime, including pure mechanisms, browser and Phaser adapters, CSS and shared data contracts | Must not import build tooling or test helpers |
| `build/`   | Build configuration, asset processing, generated metadata and plugins                                           | May import runtime and build modules          |
| `test/`    | The three shared testing APIs                                                                                   | Only test code may import these APIs          |

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

The test paths replace only the `testing/` prefix. The paths `test/storageFixture`, `test/dom/failingLocalStorage` and `test/phaser/sceneStub` map to their existing implementations.

Move image processing from `art/rgbaImage` to `build/rgbaImage`, which also exports the `RgbaImage` type. Runtime code that only needs the type should import it from `runtime/art/rgbaImage`. Build manifest construction and validation use `build/buildManifest`. The build identity and installed-build contracts use `runtime/web/pwa/buildIdentity` and `runtime/web/pwa/buildContract`.

Apply the mapping to JavaScript and TypeScript imports, test mocks and configuration, and stylesheet imports. Change the old build-info reference to `/// <reference types="@andornaut/game-kit/build/buildInfo" />`. This declaration-only export still provides `__APP_VERSION__`, `__BUILD_ID__` and `__COMMIT__`. Historical migration notes use the subpaths current at the time. The [source inventory](development.md#modules-and-environments) uses implementation paths relative to `src/`.

## Version and interface policy

The `exports` map and the exported declarations define the public interface. Internal imports are relative and acyclic, and there is no root barrel, so a pure import loads no engine.

Modules take data and callbacks only. They never depend on a game's types, control flow or test usage.

Compatible fixes are patch versions and additions are minor versions. Incompatible changes are major versions after 1.0, and minor versions with a [migration note](migrations.md) before 1.0. Update the manifest and lockfile together. Documentation-only changes need no version bump.

The kit's own tests define each module's contract. Release consumer proof uses pinned Archie and Chibi revisions and Ada's separate pinned check. Use adoption revisions for incompatible changes. See [Release artifacts and consumer proof](development.md#release-artifacts-and-consumer-proof).

The public `test/phaser/sceneStub` has a frozen shape. Extend it through its `overrides` argument.
