# Packaging

Every public path is an explicit `package.json` export under `runtime/`, `build/` or `test/`. The
release archive holds compiled JavaScript, declarations, README, licence and `SOURCE_COMMIT`,
built offline from the committed revision. A release is tagged only after CI is green for that
exact `main` commit and both games pass the consumer proof. Changes limited to `docs/` run only
lint and the attribution check in CI.

Reference: [Standalone verification](../../README.md#standalone-verification), [Release artifacts and consumer proof](../../README.md#release-artifacts-and-consumer-proof).

## Work items

| ID      | Title                                                           | Link                             |
| ------- | --------------------------------------------------------------- | -------------------------------- |
| gk-0001 | Adopt design and work files, and run only lint for docs-only CI | [gk-0001.md](../work/gk-0001.md) |
| gk-0003 | Release the merged task and proof worktrees                     | [gk-0003.md](../work/gk-0003.md) |
