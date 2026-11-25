# Packaging

Public modules use explicit `package.json` exports under `runtime/`, `build/` or `test/`. The
package also exports `package.json` for metadata. Retiring the pre-0.47 aliases changes subpath
resolution. The canonical targets and installed-build data contracts stay the same. The
release archive holds compiled JavaScript, declarations, README, licence and `SOURCE_COMMIT`,
built offline from the committed revision. Release verification and packaging use the same pinned
source. Consumer receipts identify the checks that actually ran. See the release procedure for
combining Archie and Chibi's receipt with the separately verified Ada snapshot. Docs-only CI runs
lint and the attribution check.

Like the other kits, `make check` verifies the working tree and `make lint`, `make test` and
`make build` each run one part of it. All four go through the local check runner's containers.

Place injected dependencies and configuration before the subject. Use named fields when a
caller supplies several distinct ports or measurements. Keep short positional signatures for
familiar operations with unambiguous roles. A factory's read hook can receive the object it
reads so callers can use it during construction. Keep lifecycle and persistence details
behind the public operation that owns them.

Imports are relative and acyclic. ESLint's `import-x/no-cycle` covers runtime edges in `src/`,
`scripts/` and `tests/`; `scripts/import-cycles.test.ts` also rejects cycles made only of type
imports, which that rule skips.

Reference: [Standalone verification](../../README.md#standalone-verification), [Release artifacts and consumer proof](../../README.md#release-artifacts-and-consumer-proof).

## Work items

| ID      | Title                                                                        | Link                             |
| ------- | ---------------------------------------------------------------------------- | -------------------------------- |
| gk-0001 | Adopt design and work files, and run only lint for docs-only CI              | [gk-0001.md](../work/gk-0001.md) |
| gk-0003 | Release the merged task and proof worktrees                                  | [gk-0003.md](../work/gk-0003.md) |
| gk-0012 | Close the kit test-reduction target                                          | [gk-0012.md](../work/gk-0012.md) |
| gk-0014 | Publish the runtime, build and test namespaces                               | [gk-0014.md](../work/gk-0014.md) |
| gk-0033 | Bind release checks and receipts to their evidence                           | [gk-0033.md](../work/gk-0033.md) |
| gk-0035 | Use one local check runner                                                   | [gk-0035.md](../work/gk-0035.md) |
| gk-0038 | Migrate consumers and retire obsolete GameKit interfaces                     | [gk-0038.md](../work/gk-0038.md) |
| gk-0052 | Refactor for structure, encapsulation and simplicity                         | [gk-0052.md](../work/gk-0052.md) |
| gk-0057 | Retire browserLaunchContext, add kit Makefile targets and split createLaunch | [gk-0057.md](../work/gk-0057.md) |
| gk-0060 | Guard source bands with ESLint and retire the import check                   | [gk-0060.md](../work/gk-0060.md) |
