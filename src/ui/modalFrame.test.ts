import { describe, expect, it } from "vitest";

import { MODAL_CONTENT } from "../modalLayout.ts";
import {
  MODAL_FRAME,
  type ModalFrameContext,
  modalFrameRooms,
  placeModalFrame,
} from "./modalFrame.ts";

// Ada's and Chibi's families and close control: a 24 face 6 in from the corner.
const WIDE = { large: 688, medium: 500, small: 400 } as const;
const WIDE_CLOSE = { face: { height: 24, width: 24, x: 6, y: 6 } } as const;
// Archie's: a 20 face 6 in from the corner, in a 48 target at the corner itself.
const NARROW = { large: 328, medium: 264 } as const;
const NARROW_CLOSE = {
  face: { height: 20, width: 20, x: 6, y: 6 },
  press: { height: 48, width: 48, x: 0, y: 0 },
} as const;

const card = (extra: Partial<ModalFrameContext> = {}): ModalFrameContext => ({
  content: { height: 540, width: 960, x: 0, y: 0 },
  families: WIDE,
  family: "medium",
  ...extra,
});

describe("modalFrameRooms", () => {
  it("takes the shared padding, gap and screen margin", () => {
    expect(MODAL_FRAME).toEqual({ gap: 8, margin: 16, padding: MODAL_CONTENT.padding });
  });

  it("sizes a card by its family, clamped inside the screen margin", () => {
    expect(modalFrameRooms(card())).toEqual({ body: 468, card: 500, footer: 468, title: 468 });
    expect(
      modalFrameRooms(card({ content: { height: 540, width: 400, x: 0, y: 0 }, family: "large" }))
        .card,
    ).toBe(368);
  });

  it("reserves the whole close target plus the gap on both sides of the title", () => {
    // The target reaches 6 past the right edge: 48 - 6 + 8 = 50 each side.
    expect(modalFrameRooms(card({ close: WIDE_CLOSE })).title).toBe(400);
    // Archie: 48 + 8 = 56 each side of a 264 card.
    expect(
      modalFrameRooms({
        close: NARROW_CLOSE,
        content: { height: 640, width: 360, x: 0, y: 0 },
        families: NARROW,
        family: "medium",
      }).title,
    ).toBe(152);
  });

  it("refuses invalid frames", () => {
    expect(() => modalFrameRooms(card({ family: "huge" }))).toThrow(RangeError);
    expect(() => modalFrameRooms(card({ families: { medium: 500.5 } }))).toThrow(RangeError);
    expect(() =>
      modalFrameRooms(card({ content: { height: 540, width: 32, x: 0, y: 0 } })),
    ).toThrow(RangeError);
    expect(() =>
      modalFrameRooms({
        content: { height: 10, width: 10, x: 0, y: 0 },
        family: "medium",
        variant: "fullScreen",
      }),
    ).toThrow(RangeError);
    expect(() =>
      modalFrameRooms(
        card({ close: { face: WIDE_CLOSE.face, press: { height: 20, width: 20, x: 6, y: 6 } } }),
      ),
    ).toThrow(RangeError);
    expect(() => modalFrameRooms(card({ gap: 0.5 }))).toThrow(RangeError);
    expect(() =>
      modalFrameRooms(card({ close: WIDE_CLOSE, families: { tiny: 100 }, family: "tiny" })),
    ).toThrow(RangeError);
  });
});

describe("placeModalFrame", () => {
  it("centres a card fitted to its content, with the close target exactly where it is drawn", () => {
    const layout = placeModalFrame(card({ close: WIDE_CLOSE }), {
      body: 100,
      footer: 48,
      title: { height: 28 },
    });
    // Header 28 + 2 x 16 = 60, over the 42 + 8 the close target needs; body 100; gap 8, footer
    // 48, padding 16.
    expect(layout.card).toEqual({ height: 232, width: 500, x: 230, y: 154 });
    expect(layout.header).toEqual({ height: 60, width: 500, x: 230, y: 154 });
    expect(layout.title).toEqual({ height: 28, width: 400, x: 280, y: 170 });
    expect(layout.body).toEqual({ height: 100, width: 500, x: 230, y: 214 });
    expect(layout.bodyInset).toEqual({ bottom: 0, left: 16, right: 16, top: 0 });
    expect(layout.footer).toEqual({ height: 48, width: 468, x: 246, y: 322 });
    expect(layout.scrolls).toBe(false);
    expect(layout.close).toEqual({
      face: { height: 24, width: 24, x: 700, y: 160 },
      outset: { bottom: 12, left: 12, right: 12, top: 12 },
      // Never clamped: it reaches 6 past the card's top and right edges.
      press: { height: 48, width: 48, x: 688, y: 148 },
    });
  });

  it("places Archie's off-centre target at the card's corner", () => {
    const layout = placeModalFrame(
      {
        close: NARROW_CLOSE,
        content: { height: 640, width: 360, x: 0, y: 0 },
        families: NARROW,
        family: "medium",
      },
      { body: 40, footer: 48, title: { height: 15, inset: 24 } },
    );
    expect(layout.header.height).toBe(63);
    expect(layout.title).toMatchObject({
      width: 152,
      x: layout.card.x + 56,
      y: layout.card.y + 24,
    });
    const right = layout.card.x + layout.card.width;
    expect(layout.close).toEqual({
      face: { height: 20, width: 20, x: right - 26, y: layout.card.y + 6 },
      outset: { bottom: 22, left: 22, right: 6, top: 6 },
      press: { height: 48, width: 48, x: right - 48, y: layout.card.y },
    });
  });

  it("puts the odd unit right and below when centring", () => {
    const layout = placeModalFrame(card({ content: { height: 141, width: 533, x: 3, y: 5 } }), {
      body: 20,
      title: { height: 20 },
    });
    // 533 - 32 = 501 room for a 500 card; height 52 + 20 + 16 = 88 in 141.
    expect(layout.card).toEqual({ height: 88, width: 500, x: 3 + 16, y: 5 + 26 });
    const odd = placeModalFrame(card(), { body: 20, title: { height: 21 } });
    expect(odd.title.y - odd.header.y).toBe(16);
    expect(odd.header.height).toBe(53);
  });

  it("keeps the bottom padding inside a body without a footer", () => {
    const layout = placeModalFrame(card(), { body: 30, title: { height: 20 } });
    expect(layout.footer).toBeUndefined();
    expect(layout.bodyInset.bottom).toBe(16);
    expect(layout.body.height).toBe(46);
    expect(layout.card.height).toBe(52 + 46);
  });

  it("caps the card's height at the content rect less the margins and scrolls the body", () => {
    const layout = placeModalFrame(card({ content: { height: 300, width: 960, x: 0, y: 0 } }), {
      body: 1000,
      footer: 48,
      title: { height: 28 },
    });
    expect(layout.card).toMatchObject({ height: 268, y: 16 });
    expect(layout.body.height).toBe(268 - 60 - 72);
    expect(layout.scrolls).toBe(true);
    expect(layout.footer!.y + layout.footer!.height).toBe(16 + 268 - 16);
  });

  it("lowers the body so its press areas clear the close target by the gap", () => {
    const layout = placeModalFrame(card({ close: WIDE_CLOSE }), {
      body: 48,
      bodyOutset: 12,
      title: { height: 20 },
    });
    // The target's bottom is 42 below the card's top: 42 + 8 + 12.
    expect(layout.header.height).toBe(62);
    expect(layout.title.y - layout.card.y).toBe(21);
  });

  it("moves the title by the game's ink offset", () => {
    const plain = placeModalFrame(card(), { body: 0, title: { height: 20 } });
    const inked = placeModalFrame(card(), { body: 0, title: { height: 20, inkOffset: -2 } });
    expect(inked.title.y).toBe(plain.title.y - 2);
    expect(inked.header).toEqual(plain.header);
  });

  it("makes a full-screen frame the content rect with the close anchored to the view", () => {
    const content = { height: 400, width: 800, x: 10, y: 20 };
    const layout = placeModalFrame(
      { close: { face: { height: 24, width: 24, x: 8, y: 8 } }, content, variant: "fullScreen" },
      { body: 1000, footer: 48, title: { height: 28 } },
    );
    expect(layout.card).toEqual(content);
    expect(layout.close!.face).toEqual({ height: 24, width: 24, x: 10 + 800 - 32, y: 28 });
    expect(layout.body.height).toBe(400 - 60 - 72);
    expect(layout.scrolls).toBe(true);
    const short = placeModalFrame(
      { content, variant: "fullScreen" },
      { body: 10, title: { height: 28 } },
    );
    expect(short.body.height).toBe(400 - 60);
    expect(short.scrolls).toBe(false);
  });

  it("projects every edge through the game's projection", () => {
    const layout = placeModalFrame(
      card({ close: WIDE_CLOSE, project: { x: (edge) => 2 * edge, y: (edge) => 3 * edge } }),
      { body: 100, footer: 48, title: { height: 28 } },
    );
    expect(layout.card).toEqual({ height: 696, width: 1000, x: 460, y: 462 });
    expect(layout.close!.outset).toEqual({ bottom: 36, left: 24, right: 24, top: 36 });
    expect(() =>
      placeModalFrame(card({ project: { x: (edge) => edge / 3, y: (edge) => edge } }), {
        body: 0,
        title: { height: 20 },
      }),
    ).toThrow(RangeError);
  });

  it("refuses sizes that are not whole units or a header and footer taller than the room", () => {
    expect(() => placeModalFrame(card(), { body: 1.5, title: { height: 20 } })).toThrow(RangeError);
    expect(() =>
      placeModalFrame(card(), { body: 0, title: { height: 20, inkOffset: 0.5 } }),
    ).toThrow(RangeError);
    expect(() =>
      placeModalFrame(card({ content: { height: 100, width: 960, x: 0, y: 0 } }), {
        body: 0,
        footer: 48,
        title: { height: 28 },
      }),
    ).toThrow(RangeError);
  });
});
