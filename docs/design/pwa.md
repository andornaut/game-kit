# PWA

The kit supplies the app window, install, back and exit handling, offline play, the service
worker with its precache manifest, update offers and never-throwing save storage. Games own
registration, policies and copy.

The first install downloads and verifies the complete build from the page under the one loading screen; updates stage in the background and switch silently at launch or through the game's Update now. See the [install and update design](../install-and-update.md).

Reference: [Classic service-worker output](../../README.md#classic-service-worker-output).

## Work items

| ID      | Title                                                                       | Link                             |
| ------- | --------------------------------------------------------------------------- | -------------------------------- |
| gk-0002 | Remove the deprecated update no-ops                                         | [gk-0002.md](../work/gk-0002.md) |
| gk-0005 | Add the Exit availability check                                             | [gk-0005.md](../work/gk-0005.md) |
| gk-0006 | Ignore verified JSON response headers without body semantics                | [gk-0006.md](../work/gk-0006.md) |
| gk-0007 | Recover from failed activations and slow switches                           | [gk-0007.md](../work/gk-0007.md) |
| gk-0008 | Install the complete build from the page and switch builds through a router | [gk-0008.md](../work/gk-0008.md) |
| gk-0009 | Pack small files to cut install requests                                    | [gk-0009.md](../work/gk-0009.md) |
| gk-0016 | Retry a failed first install from the loading failure                       | [gk-0016.md](../work/gk-0016.md) |
| gk-0018 | Reuse verified identical JSON bodies                                        | [gk-0018.md](../work/gk-0018.md) |
| gk-0019 | Bound asset-group requests by inactivity                                    | [gk-0019.md](../work/gk-0019.md) |
| gk-0020 | Encode the precache manifest compactly                                      | [gk-0020.md](../work/gk-0020.md) |
| gk-0028 | Diagnose installed game update discovery                                    | [gk-0028.md](../work/gk-0028.md) |
| gk-0030 | Check for updates on return to Start                                        | [gk-0030.md](../work/gk-0030.md) |
| gk-0032 | Recover from stale update offers and failed startup storage reads           | [gk-0032.md](../work/gk-0032.md) |
| gk-0036 | Close an obsolete update prompt                                             | [gk-0036.md](../work/gk-0036.md) |
| gk-0039 | Check for updates when the installed window regains focus                    | [gk-0039.md](../work/gk-0039.md) |
