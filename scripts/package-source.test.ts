import { expect, it } from "vitest";

import { buildProvenance } from "./package-source.ts";

const revision = "a".repeat(40);
const sha256 = "b".repeat(64);
const source = {
  CHECK_REVISION: revision,
  CHECK_SOURCE_DIRTY: "true",
  CHECK_SOURCE_SHA256: sha256,
  SOURCE_DATE_EPOCH: "1700000000",
};

it("marks working snapshots as private check builds while retaining exact source identity", () => {
  expect(buildProvenance(source)).toEqual({
    revision,
    snapshot: { dirty: true, revision, scope: "private-check-build", sha256 },
  });
});

it("refuses an exported dirty snapshot and permits a clean committed release", () => {
  expect(() => buildProvenance({ ...source, CHECK_EXPORT: "1" })).toThrow("clean source snapshot");
  expect(buildProvenance({ ...source, CHECK_EXPORT: "1", CHECK_SOURCE_DIRTY: "false" })).toEqual({
    revision,
    snapshot: undefined,
  });
});

it("accepts the existing committed archive provenance port", () => {
  expect(buildProvenance({ SOURCE_COMMIT: revision, SOURCE_DATE_EPOCH: "1700000000" })).toEqual({
    revision,
    snapshot: undefined,
  });
});

it.each([
  { CHECK_REVISION: "short" },
  { CHECK_SOURCE_SHA256: "short" },
  { CHECK_SOURCE_DIRTY: "unknown" },
  { SOURCE_DATE_EPOCH: "" },
])("rejects missing or malformed source provenance %o", (override) => {
  expect(() => buildProvenance({ ...source, ...override })).toThrow();
});
