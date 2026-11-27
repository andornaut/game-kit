# Build

Build-time modules configure a game's Vite and Vitest, emit reduced Phaser bundles, hash icons
and content, record build identity and render security headers. They may import runtime modules
but never test helpers.

See [API namespaces and migration](../guides/using-game-kit.md#api-namespaces-and-migration).

## Work items

| ID      | Title                                        | Link                             |
| ------- | -------------------------------------------- | -------------------------------- |
| gk-0015 | Emit a self-contained classic service worker | [gk-0015.md](../work/gk-0015.md) |
| gk-0027 | Cap GameKit containers at 4 GiB              | [gk-0027.md](../work/gk-0027.md) |
