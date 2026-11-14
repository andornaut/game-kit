import { describe, expect, it, vi } from "vitest";

import {
  type ControlAvailability,
  controlPresentation,
  disclosurePath,
  invokeControl,
  validatePageDivider,
} from "./controlPresentation.ts";

describe("control availability", () => {
  it("keeps unmet requirements visible with their supplied reason and prevents action execution", () => {
    const state = { kind: "unavailable", reason: "Requires another item" } as const;
    const action = vi.fn();
    expect(controlPresentation(state)).toEqual({
      executable: false,
      reason: state.reason,
      visible: true,
    });
    expect(invokeControl(state, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("omits irrelevant controls and invokes an available action exactly once", () => {
    const action = vi.fn();
    expect(controlPresentation({ kind: "omitted" })).toEqual({ executable: false, visible: false });
    expect(invokeControl({ kind: "omitted" }, action)).toBe(false);
    expect(invokeControl({ kind: "available" }, action)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it.each(["", "   ", "\n"])("rejects missing refusal explanations (%j)", (reason) => {
    expect(() => controlPresentation({ kind: "unavailable", reason })).toThrow(RangeError);
  });

  it("rejects unrecognised runtime availability", () => {
    expect(() => controlPresentation({ kind: "other" } as unknown as ControlAvailability)).toThrow(
      RangeError,
    );
  });
});

describe("shared divider and disclosure tokens", () => {
  it("fits a right disclosure stroke inside the caller's box without a font glyph", () => {
    expect(disclosurePath({ colour: 0x123456, height: 14, strokeWidth: 2, width: 8 })).toEqual([
      { x: 1, y: 1 },
      { x: 7, y: 7 },
      { x: 1, y: 13 },
    ]);
  });

  it.each([
    { height: 0 },
    { width: Number.POSITIVE_INFINITY },
    { strokeWidth: 8 },
    { strokeWidth: -1 },
    { colour: -1 },
    { colour: 0x1000000 },
    { colour: 0.5 },
  ])("rejects invalid disclosure geometry or colour: %j", (change) => {
    expect(() =>
      disclosurePath({ colour: 0, height: 14, strokeWidth: 2, width: 8, ...change }),
    ).toThrow(RangeError);
  });

  it("accepts caller-authored divider tokens and rejects invalid ones", () => {
    expect(() => validatePageDivider({ colour: 0, thickness: 1 })).not.toThrow();
    for (const thickness of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validatePageDivider({ colour: 0, thickness })).toThrow(RangeError);
    }
    expect(() => validatePageDivider({ colour: 0x1000000, thickness: 1 })).toThrow(RangeError);
  });
});
