# Work items

Each user request has one file, `docs/work/<id>.md`, regardless of approval status. The file records scope, decisions and outcome.
Live claims, blocks, receipts and acceptance stay in the work protocol state root. Browse items by
area in the [design index](../design/README.md) or return to the [documentation index](../README.md).

| Front matter | Content                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `id`         | `gk-` and a zero-padded sequence (`gk-0001`), allocated in order of recording. |
| `title`      | A short imperative title.                                                      |
| `status`     | `proposed`, `approved`, `declined`, `done`, `cancelled` or `superseded`.       |
| `approved`   | A short approval or decline reference, such as `user, 2026-11-18`.             |
| `design`     | The design area in `docs/design/`.                                             |
| `related`    | A list of related work IDs.                                                    |
| `supersedes` | The ID of the item this one replaces; omitted otherwise.                       |

The sections are Scope, Criteria, Decisions and Outcome. Decisions and Outcome state what was
decided or delivered, and why, in a line or two each.

- Only `main` edits design index tables and approved scope. Approval commits the work-file stub
  and its index row on `main`, and that commit allocates the ID.
- Workers edit only their own work file and the design prose that ships with their feature.
  The commit that lands the item sets `status: done`; a release tag containing that commit
  marks it deployed.
- A changed or reverted decision is a new work item with `supersedes`. A finished item's outcome
  is never rewritten.
- Work files are public: no session IDs, hostnames, local home-directory paths or quoted
  conversation, only short approval references.
- Items approved before work files existed are recorded under the next IDs, with the approval
  ledger key in `approved`. Other earlier work is recorded in the [migration and release notes](../reference/migrations.md) and Git history.
- Local docs-only checks cover attribution and lint ([gk-0001](gk-0001.md)). Hosted CI skips
  runtime jobs on classified changes confined to `docs/`. Root `README.md` changes run the normal
  [verification jobs](../guides/development.md#standalone-verification).
- Work files are not part of the release archive.
