# PWA

The kit supplies the app window, install, back and exit handling, offline play, the service
worker with its precache manifest, update offers and never-throwing save storage. Games own
registration, policies and copy.

The first install downloads and verifies the complete build from the page under the one loading screen; updates stage in the background and switch silently at launch or through the game's Update now. See the [install and update design](../install-and-update.md).

Reference: [Classic service-worker output](../../README.md#classic-service-worker-output).

## Work items

| ID                                           | Title                                                                       | Link                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| gk-0002                                      | Remove the deprecated update no-ops                                         | [gk-0002.md](../work/gk-0002.md)                                                                           |
| gk-0005                                      | Add the Exit availability check                                             | [gk-0005.md](../work/gk-0005.md)                                                                           |
| gk-0006                                      | Ignore verified JSON response headers without body semantics                | [gk-0006.md](../work/gk-0006.md)                                                                           |
| gk-0007                                      | Recover from failed activations and slow switches                           | [gk-0007.md](../work/gk-0007.md)                                                                           |
| gk-0008                                      | Install the complete build from the page and switch builds through a router | [gk-0008.md](../work/gk-0008.md)                                                                           |
| gk-0009                                      | Pack small files to cut install requests                                    | [gk-0009.md](../work/gk-0009.md)                                                                           |
| game-kit-offline-install-retry-049           | Retry a failed first install from the loading failure                       | [game-kit-offline-install-retry-049.md](../work/game-kit-offline-install-retry-049.md)                     |
| game-kit-verified-body-reuse-052-publication | Reuse verified identical JSON bodies                                        | [game-kit-verified-body-reuse-052-publication.md](../work/game-kit-verified-body-reuse-052-publication.md) |
| game-kit-inactivity-timeout-052-publication  | Bound asset-group requests by inactivity                                    | [game-kit-inactivity-timeout-052-publication.md](../work/game-kit-inactivity-timeout-052-publication.md)   |
| game-kit-precache-wire-053-publication       | Encode the precache manifest compactly                                      | [game-kit-precache-wire-053-publication.md](../work/game-kit-precache-wire-053-publication.md)             |
