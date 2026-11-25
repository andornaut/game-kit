import { describe, expect, it, vi } from "vitest";

import { seededRandom } from "../random.ts";
import { type Rect, rectsOverlap } from "../rect.ts";
import {
  ACTION_GAPS,
  type ActionGroupContext,
  type ActionItem,
  arrangeActions,
  type PlacedAction,
  pressedAction,
} from "./actionGroup.ts";
import type { ButtonRole } from "./buttonLayout.ts";
import { BUTTON_GAP, SMALL_BUTTON_GAP, STACK_BUTTON_GAP } from "./spacing.ts";

const action = (
  key: string,
  role: ButtonRole,
  width: number,
  height = 48,
  extra: Partial<ActionItem<string>> = {},
): ActionItem<string> => ({ key, role, size: { height, width }, ...extra });

function placed<K, T>(arrangement: { actions: readonly unknown[] }, key: K): PlacedAction<K, T> {
  const found = (arrangement.actions as (PlacedAction<K, T> | { hidden: true; key: K })[]).find(
    (entry) => entry.key === key,
  );
  if (found === undefined || found.hidden) {
    throw new Error(`No placed action ${String(key)}`);
  }
  return found;
}

describe("arrangeActions", () => {
  it("takes the shared gap tokens", () => {
    expect(ACTION_GAPS.standard).toEqual({
      name: "standard",
      row: BUTTON_GAP,
      stack: STACK_BUTTON_GAP,
    });
    expect(ACTION_GAPS.small).toEqual({
      name: "small",
      row: SMALL_BUTTON_GAP,
      stack: SMALL_BUTTON_GAP,
    });
  });

  it("centres a fitting row, the odd unit on the right, secondary left and primary right", () => {
    const result = arrangeActions({ width: 201 }, [
      action("ok", "primary", 50),
      action("back", "secondary", 60),
    ]);
    expect(result.axis).toBe("row");
    expect(result.gap.name).toBe("standard");
    expect(result.group).toEqual({ height: 48, width: 201, x: 0, y: 0 });
    expect(result.actions.map((entry) => entry.key)).toEqual(["ok", "back"]);
    const back = placed(result, "back");
    const ok = placed(result, "ok");
    expect(back.face).toEqual({ height: 48, width: 60, x: 37, y: 0 });
    expect(ok.face).toEqual({ height: 48, width: 50, x: 113, y: 0 });
    expect([back.order, ok.order]).toEqual([0, 1]);
    expect(back.outset).toEqual({ bottom: 12, left: 12, right: 8, top: 12 });
    expect(ok.outset).toEqual({ bottom: 12, left: 8, right: 12, top: 12 });
    expect(back.press).toEqual({ height: 72, width: 80, x: 25, y: -12 });
    expect(back.press.x + back.press.width).toBe(ok.press.x);
  });

  it("centres a sole visible action and ignores hidden ones", () => {
    const result = arrangeActions({ width: 100 }, [
      action("hidden", "secondary", 60, 48, { hidden: true }),
      action("close", "secondary", 40),
    ]);
    expect(result.actions[0]).toEqual({ hidden: true, key: "hidden", role: "secondary" });
    expect(placed(result, "close").face.x).toBe(30);
    expect(placed(result, "close").outset).toEqual({ bottom: 10, left: 10, right: 10, top: 10 });
  });

  it("centres faces of different heights on the row, the odd unit below", () => {
    const result = arrangeActions({ width: 200 }, [
      action("a", "secondary", 40, 48),
      action("b", "secondary", 40, 35),
    ]);
    expect(result.group.height).toBe(48);
    expect(placed(result, "b").face.y).toBe(6);
  });

  it("stacks a row that does not fit, stretching faces to the widest and the primary last", () => {
    const result = arrangeActions({ width: 100 }, [
      action("ok", "primary", 80),
      action("back", "secondary", 60),
    ]);
    expect(result.axis).toBe("stack");
    expect(result.group).toEqual({ height: 104, width: 100, x: 0, y: 0 });
    expect(placed(result, "back").face).toEqual({ height: 48, width: 80, x: 10, y: 0 });
    expect(placed(result, "ok").face).toEqual({ height: 48, width: 80, x: 10, y: 56 });
    expect(placed(result, "back").outset.bottom).toBe(4);
    expect(placed(result, "ok").outset.top).toBe(4);
    expect(placed(result, "ok").outset.left).toBe(12);
  });

  it("keeps art-locked faces at their size and fills the room when asked", () => {
    const locked = arrangeActions({ width: 100 }, [
      action("back", "secondary", 61, 48, { locked: true }),
      action("ok", "primary", 80),
    ]);
    expect(placed(locked, "back").face).toEqual({ height: 48, width: 61, x: 19, y: 0 });
    const filled = arrangeActions({ stackWidth: "fill", width: 100 }, [
      action("back", "secondary", 60),
      action("ok", "primary", 80),
    ]);
    expect(placed(filled, "ok").face).toEqual({ height: 48, width: 100, x: 0, y: 56 });
  });

  it("forces an axis, and refuses a forced row that does not fit", () => {
    const items = [action("a", "secondary", 40), action("b", "primary", 40)];
    expect(arrangeActions({ axis: "stack", width: 200 }, items).axis).toBe("stack");
    expect(() => arrangeActions({ axis: "row", width: 90 }, items)).toThrow(RangeError);
    expect(() => arrangeActions({ width: 30 }, items)).toThrow(RangeError);
  });

  it("splits an odd named override gap, the odd unit to the later neighbour", () => {
    const gap = { name: "tight-footer", row: 9, stack: 5 };
    const result = arrangeActions({ gap, width: 200 }, [
      action("a", "secondary", 60),
      action("b", "primary", 60),
    ]);
    expect(result.gap).toEqual(gap);
    expect(placed(result, "a").face.x).toBe(35);
    expect(placed(result, "b").face.x).toBe(104);
    expect(placed(result, "a").outset.right).toBe(4);
    expect(placed(result, "b").outset.left).toBe(5);
    const a = placed(result, "a").press;
    expect(a.x + a.width).toBe(placed(result, "b").press.x);
  });

  it("grows small faces to the minimum target before clamping toward neighbours", () => {
    const sole = arrangeActions({ width: 100 }, [action("a", "secondary", 21, 20)]);
    const outset = placed(sole, "a").outset;
    expect(outset).toEqual({ bottom: 14, left: 13, right: 14, top: 14 });
    expect(placed(sole, "a").press.width).toBe(48);
    const pair = arrangeActions({ gap: "small", width: 200 }, [
      action("a", "secondary", 20, 20),
      action("b", "secondary", 20, 20),
    ]);
    expect(placed(pair, "a").outset).toEqual({ bottom: 14, left: 14, right: 12, top: 14 });
    expect(placed(pair, "b").outset.left).toBe(12);
  });

  it("takes a fixed press margin", () => {
    const result = arrangeActions({ press: { margin: 0 }, width: 100 }, [
      action("a", "secondary", 40),
    ]);
    expect(placed(result, "a").press).toEqual(placed(result, "a").face);
  });

  it("pins footer edges with a centred middle slot", () => {
    const result = arrangeActions(
      { middle: { height: 48, width: 80 }, variant: "footer", width: 300 },
      [action("ok", "primary", 70), action("back", "secondary", 60)],
    );
    expect(result.variant).toBe("footer");
    expect(result.axis).toBe("row");
    expect(placed(result, "back").face.x).toBe(0);
    expect(result.middle).toEqual({ height: 48, width: 80, x: 110, y: 0 });
    expect(placed(result, "ok").face.x).toBe(230);
    expect(placed(result, "back").outset.right).toBe(12);
    expect(placed(result, "ok").outset.left).toBe(12);
  });

  it("keeps a lone footer action at its edge beside a middle slot, and centres it without one", () => {
    const pinned = arrangeActions(
      { middle: { height: 48, width: 80 }, variant: "footer", width: 300 },
      [action("back", "secondary", 60)],
    );
    expect(placed(pinned, "back").face.x).toBe(0);
    const sole = arrangeActions({ variant: "footer", width: 300 }, [
      action("back", "secondary", 60, 48, { hidden: true }),
      action("ok", "primary", 70),
    ]);
    expect(placed(sole, "ok").face.x).toBe(115);
    const secondaries = arrangeActions({ variant: "footer", width: 300 }, [
      action("a", "secondary", 60),
      action("b", "navigation", 60),
    ]);
    expect(placed(secondaries, "b").face.x).toBe(76);
  });

  it("stacks a footer that does not fit, middle slot first and the primary last", () => {
    const result = arrangeActions(
      { middle: { height: 48, width: 80 }, variant: "footer", width: 150 },
      [action("ok", "primary", 70), action("back", "secondary", 60)],
    );
    expect(result.axis).toBe("stack");
    expect(result.middle).toEqual({ height: 48, width: 80, x: 35, y: 0 });
    expect(placed(result, "back").face).toEqual({ height: 48, width: 70, x: 40, y: 56 });
    expect(placed(result, "ok").face).toEqual({ height: 48, width: 70, x: 40, y: 112 });
    expect(placed(result, "back").outset.top).toBe(4);
    expect(result.group.height).toBe(160);
  });

  it("projects edges through the game's hook and places text from the projected face", () => {
    const placeText = vi.fn((face: Rect) => face.x + 1);
    const project = { x: (edge: number) => Math.round(edge * 1.5), y: (edge: number) => edge * 2 };
    const result = arrangeActions({ origin: { x: 4, y: 10 }, placeText, project, width: 201 }, [
      action("a", "secondary", 60),
      action("b", "primary", 50),
    ]);
    const a = placed<string, number>(result, "a");
    const b = placed<string, number>(result, "b");
    expect(a.face).toEqual({ height: 96, width: 90, x: 62, y: 20 });
    expect(a.press.x + a.press.width).toBe(b.press.x);
    expect(a.outset.right).toBe(b.face.x - (a.face.x + a.face.width) - b.outset.left);
    expect(result.group).toEqual({ height: 96, width: 302, x: 6, y: 20 });
    expect(a.text).toBe(63);
    expect(placeText).toHaveBeenCalledWith(a.face, expect.objectContaining({ key: "a" }));
    expect(() =>
      arrangeActions({ project: { x: (edge) => edge * 1.5, y: (edge) => edge }, width: 201 }, [
        action("a", "secondary", 61),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      arrangeActions({ project: { x: (edge) => -edge, y: (edge) => edge }, width: 200 }, [
        action("a", "secondary", 60),
      ]),
    ).toThrow(RangeError);
  });

  it.each<[string, ActionGroupContext<string>, ActionItem<string>[]]>([
    ["a fractional width", { width: 100.5 }, [action("a", "secondary", 40)]],
    ["a fractional face", { width: 100 }, [action("a", "secondary", 40.5)]],
    ["an empty face", { width: 100 }, [action("a", "secondary", 0)]],
    ["two primaries", { width: 300 }, [action("a", "primary", 40), action("b", "primary", 40)]],
    ["duplicate keys", { width: 300 }, [action("a", "secondary", 40), action("a", "primary", 40)]],
    ["an unknown gap", { gap: "wide" as "small", width: 100 }, []],
    ["a reserved override name", { gap: { name: "standard", row: 8, stack: 8 }, width: 100 }, []],
    ["an unnamed override", { gap: { name: " ", row: 8, stack: 8 }, width: 100 }, []],
    ["a fractional gap", { gap: { name: "x", row: 8.5, stack: 8 }, width: 100 }, []],
    ["a middle slot outside a footer", { middle: { height: 1, width: 1 }, width: 100 }, []],
    ["a fractional press margin", { press: { margin: 1.5 }, width: 100 }, []],
    ["an unknown role", { width: 100 }, [action("a", "other" as ButtonRole, 40)]],
  ])("refuses %s", (_name, context, items) => {
    expect(() => arrangeActions(context, items)).toThrow(RangeError);
  });

  it("allows two primaries while only one is visible", () => {
    const result = arrangeActions({ width: 300 }, [
      action("a", "primary", 40, 48, { hidden: true }),
      action("b", "primary", 40),
    ]);
    expect(placed(result, "b").face.x).toBe(130);
  });

  it("never overlaps press areas, faces or gaps across generated groups", () => {
    const random = seededRandom(54);
    const int = (least: number, most: number) => least + Math.floor(random() * (most - least + 1));
    let checked = 0;
    for (let run = 0; run < 400; run += 1) {
      const count = int(0, 5);
      const primary = int(-1, count - 1);
      const items = Array.from({ length: count }, (_, index) =>
        action(`k${index}`, index === primary ? "primary" : "secondary", int(1, 90), int(1, 60), {
          hidden: random() < 0.2,
          locked: random() < 0.3,
        }),
      );
      const gap = { name: "generated", row: int(0, 30), stack: int(0, 30) };
      const variant = random() < 0.5 ? "group" : "footer";
      const context: ActionGroupContext<string> = {
        gap,
        stackWidth: random() < 0.5 ? "content" : "fill",
        variant,
        width: int(0, 400),
        ...(variant === "footer" && random() < 0.5
          ? { middle: { height: int(1, 48), width: int(1, 80) } }
          : {}),
      };
      let result;
      try {
        result = arrangeActions(context, items);
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        continue;
      }
      checked += 1;
      const shown = result.actions.filter((entry) => !entry.hidden) as PlacedAction<string>[];
      const faces = [
        ...shown.map((entry) => entry.face),
        ...(result.middle ? [result.middle] : []),
      ];
      for (const rect of [...faces, ...shown.map((entry) => entry.press)]) {
        for (const value of Object.values(rect)) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
      for (const face of faces) {
        expect(face.x).toBeGreaterThanOrEqual(0);
        expect(face.x + face.width).toBeLessThanOrEqual(context.width);
      }
      for (const [i, a] of shown.entries()) {
        for (const other of faces) {
          if (other !== a.face) {
            expect(rectsOverlap(a.press, other)).toBe(false);
          }
        }
        for (const b of shown.slice(i + 1)) {
          expect(rectsOverlap(a.press, b.press)).toBe(false);
          const along = result.axis === "row" ? "x" : "y";
          const length = result.axis === "row" ? "width" : "height";
          const [first, second] = a.order < b.order ? [a.face, b.face] : [b.face, a.face];
          expect(second[along] - (first[along] + first[length])).toBeGreaterThanOrEqual(
            result.axis === "row" ? gap.row : gap.stack,
          );
        }
      }
      const primaryAction = shown.find((entry) => entry.role === "primary");
      if (primaryAction !== undefined) {
        expect(primaryAction.order).toBe(shown.length - 1);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  describe("nearest press overlap", () => {
    // Archie's top bar: 20 unit faces the small gap apart, each grown to the 48 unit minimum.
    const discs = (keys: readonly string[], width = 20) =>
      keys.map((key) => action(key, "secondary", width, 20));

    it("keeps each full minimum press, overlapping its neighbours", () => {
      const result = arrangeActions({ gap: "small", pressOverlap: "nearest", width: 108 }, [
        ...discs(["a", "b", "c"]),
      ]);
      expect(result.pressOverlap).toBe("nearest");
      const [a, b, c] = ["a", "b", "c"].map((key) => placed(result, key));
      expect([a!.face.x, b!.face.x, c!.face.x]).toEqual([0, 44, 88]);
      for (const entry of [a!, b!, c!]) {
        expect(entry.press.width).toBe(48);
        expect(entry.press.height).toBe(48);
      }
      expect(a!.press).toEqual({ height: 48, width: 48, x: -14, y: -14 });
      expect(rectsOverlap(a!.press, b!.press)).toBe(true);
      // The drawn outsets cut at the centres' midpoint, so DOM hit testing routes as pressedAction.
      expect(a!.outset).toEqual({ bottom: 14, left: 14, right: 12, top: 14 });
      expect(b!.outset).toEqual({ bottom: 14, left: 12, right: 12, top: 14 });
      expect(c!.outset).toEqual({ bottom: 14, left: 12, right: 14, top: 14 });
    });

    it("clamps by default, and refuses an unknown overlap", () => {
      const result = arrangeActions({ gap: "small", width: 108 }, discs(["a", "b"]));
      expect(result.pressOverlap).toBe("clamp");
      expect(placed(result, "a").press.width).toBe(46);
      expect(rectsOverlap(placed(result, "a").press, placed(result, "b").press)).toBe(false);
      expect(() =>
        arrangeActions(
          { pressOverlap: "share" as unknown as "nearest", width: 108 },
          discs(["a", "b"]),
        ),
      ).toThrow(RangeError);
    });

    it("routes a press to the nearest face centre, the earlier action on a tie", () => {
      // Faces at 0..20 and 45..65: centres 10 and 55, midpoint 32.5.
      const result = arrangeActions(
        { gap: { name: "odd", row: 25, stack: 25 }, pressOverlap: "nearest", width: 65 },
        discs(["a", "b"]),
      );
      expect(pressedAction(result, { x: 32, y: 10 })).toBe("a");
      expect(pressedAction(result, { x: 32.5, y: 10 })).toBe("a");
      expect(pressedAction(result, { x: 32.6, y: 10 })).toBe("b");
      expect(pressedAction(result, { x: -14, y: 10 })).toBe("a");
      expect(pressedAction(result, { x: -15, y: 10 })).toBeUndefined();
      // The unit cell 32 (its centre on the tie) is the earlier action's, cell 33 the later's.
      expect(placed(result, "a").outset.right).toBe(13);
      expect(placed(result, "b").outset.left).toBe(12);
      expect(pressedAction(result, { x: 33.5, y: 10 })).toBe("b");
    });

    it("routes unequal faces by their centres, not the gap's midpoint", () => {
      // Faces at 0..28 and 52..62: centres 14 and 57, so the cut is at 36, not the gap's 40.
      const result = arrangeActions({ gap: "small", pressOverlap: "nearest", width: 62 }, [
        action("wide", "secondary", 28, 20),
        action("dot", "secondary", 10, 20),
      ]);
      const wide = placed(result, "wide");
      const dot = placed(result, "dot");
      expect(wide.outset.right).toBe(8);
      expect(dot.outset.left).toBe(16);
      expect(wide.press).toEqual({ height: 48, width: 48, x: -10, y: -14 });
      expect(dot.press).toEqual({ height: 48, width: 48, x: 33, y: -14 });
      expect(pressedAction(result, { x: 35.4, y: 10 })).toBe("wide");
      expect(pressedAction(result, { x: 35.5, y: 10 })).toBe("wide");
      expect(pressedAction(result, { x: 35.6, y: 10 })).toBe("dot");
    });

    it("routes along a stack, and clamps toward a footer's middle slot", () => {
      const stack = arrangeActions(
        { axis: "stack", gap: "small", pressOverlap: "nearest", width: 20 },
        discs(["a", "b"]),
      );
      expect(placed(stack, "a").outset.bottom).toBe(12);
      expect(placed(stack, "b").press.height).toBe(48);
      expect(pressedAction(stack, { x: 10, y: 31.5 })).toBe("a");
      expect(pressedAction(stack, { x: 10, y: 32.5 })).toBe("b");
      const footer = arrangeActions(
        {
          middle: { height: 20, width: 20 },
          pressOverlap: "nearest",
          variant: "footer",
          width: 100,
        },
        [action("back", "secondary", 20, 20), action("ok", "primary", 20, 20)],
      );
      expect(footer.middle).toEqual({ height: 20, width: 20, x: 40, y: 0 });
      expect(placed(footer, "back").outset.right).toBe(10);
      expect(placed(footer, "back").press.width).toBe(48);
      expect(placed(footer, "ok").outset.left).toBe(10);
    });

    it("skips hidden actions and projects the full press", () => {
      const result = arrangeActions(
        {
          gap: "small",
          pressOverlap: "nearest",
          project: { x: (edge) => edge * 2, y: (edge) => edge * 2 },
          width: 64,
        },
        [...discs(["a"]), action("gone", "secondary", 20, 20, { hidden: true }), ...discs(["b"])],
      );
      expect(placed(result, "a").press).toEqual({ height: 96, width: 96, x: -28, y: -28 });
      expect(placed(result, "a").outset.right).toBe(24);
      expect(pressedAction(result, { x: 63, y: 20 })).toBe("a");
      expect(pressedAction(result, { x: 65, y: 20 })).toBe("b");
    });
  });
});
