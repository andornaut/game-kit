# PWA

The kit supplies the app window, install, back and exit handling, offline play, the service
worker with its precache manifest, update offers and never-throwing save storage. Games own
registration, policies and copy.

`dom/launch` and `dom/serviceWorker` bind pages, Cache Storage, the network and timers. Their
decisions are pure functions in `launchRules` and `routerRules`: progress, the progress carry,
update-check timing and backoff, deploy and staged-record checks, routed requests and pin pruning.
`dom/launchGroups` holds the grouped first install and grouped staging that `createLaunch` runs.
It takes the page, stores and launch state as an injected context and keeps no state of its own.

The first install downloads and verifies the complete build from the page under the one loading screen; updates stage in the background and switch silently at launch or through the game's Update now. See the [install and update design](../install-and-update.md).

Reference: [Build output](../../README.md#build-output).

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
| gk-0039 | Check for updates when the installed window regains focus                   | [gk-0039.md](../work/gk-0039.md) |
| gk-0041 | Stage an update as one verified build archive                               | [gk-0041.md](../work/gk-0041.md) |
| gk-0042 | Preserve plain-text assets in whole-build archives                          | [gk-0042.md](../work/gk-0042.md) |
| gk-0043 | Verify listed network responses before serving                              | [gk-0043.md](../work/gk-0043.md) |
| gk-0044 | Download grouped updates with independently reusable archives               | [gk-0044.md](../work/gk-0044.md) |
| gk-0045 | Serve packed origin members at their original URLs                          | [gk-0045.md](../work/gk-0045.md) |
| gk-0046 | Reconstruct verified update archives from origin member bodies              | [gk-0046.md](../work/gk-0046.md) |
| gk-0047 | Remove redundant delivery paths from grouped packing                        | [gk-0047.md](../work/gk-0047.md) |
| gk-0048 | Use prebuilt groups for install and updates                                 | [gk-0048.md](../work/gk-0048.md) |
| gk-0049 | Show shared error when browser launch is unavailable                        | [gk-0049.md](../work/gk-0049.md) |
| gk-0050 | Install only the device codec from groups and read archive members          | [gk-0050.md](../work/gk-0050.md) |
| gk-0051 | Compress group archives and export a test encoder                           | [gk-0051.md](../work/gk-0051.md) |
| gk-0053 | Opt out of decoded group copies and require DecompressionStream at launch   | [gk-0053.md](../work/gk-0053.md) |
| gk-0076 | Recover audio groups for the active installed build                         | [gk-0076.md](../work/gk-0076.md) |
| gk-0077 | Reject the JSON-data reuse profile with archive updates                     | [gk-0077.md](../work/gk-0077.md) |
