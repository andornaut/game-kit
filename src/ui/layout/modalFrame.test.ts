import { describe, expect, it } from "vitest";

import { MODAL_CONTENT } from "../../modalLayout.ts";
import type { Rect } from "../../rect.ts";
import { type ActionProjection, arrangeActions } from "../actions/actionGroup.ts";
import {
  MODAL_FRAME,
  type ModalFrameContext,
  modalFrameRooms,
  type ModalFrameSizes,
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

// Archie's frameless full-screen page (Pet shop, Logbook, Help), from its own data: a 360x560
// screen under a 40 tall top bar; the 16 modal padding; a header of 63, the 15 rows of a 5-row
// capital at scale 3 with the padding and the 8 gap above and below; content 8 in from each side;
// Back 48 tall and 12 above the screen's foot; the 8 gap over Back.
const ARCHIE_PAGE = {
  context: {
    content: { height: 520, width: 360, x: 0, y: 40 },
    insets: { bottom: 12, side: 8 },
    variant: "page",
  },
  sizes: { body: 600, footer: 48, title: { height: 15, inset: 24 } },
} as const satisfies { context: ModalFrameContext; sizes: ModalFrameSizes };
// Archie's own rects: the title row its ink is centred in (cardTitleRow), the region from the
// header to the gap over Back that holds its tabs, list and scrollbar, and Back at its 128 width.
const ARCHIE = {
  back: { height: 48, width: 128, x: 116, y: 500 },
  region: { height: 500 - 8 - 103, width: 360, x: 0, y: 103 },
  title: { height: 15, width: 328, x: 16, y: 64 },
} as const;

// Archie's DOM grid (domScale gridX, gridY and gridRect): a game edge's exact device place from
// the layer's grid-snapped corner, rounded to whole art pixels.
function archieGrid(scale: { dpr: number; origin: { x: number; y: number }; unit: number }) {
  const art = Math.max(1, Math.floor(scale.unit * scale.dpr + 1e-9));
  const axis = (origin: number) => (edge: number) => {
    const exact = (origin + edge * scale.unit) * scale.dpr - Math.round(origin * scale.dpr);
    return Math.round(exact / art) * art;
  };
  const project: ActionProjection = { x: axis(scale.origin.x), y: axis(scale.origin.y) };
  const gridRect = (rect: Rect): Rect => {
    const left = project.x(rect.x);
    const top = project.y(rect.y);
    return {
      height: Math.max(art, project.y(rect.y + rect.height) - top),
      width: Math.max(art, project.x(rect.x + rect.width) - left),
      x: left,
      y: top,
    };
  };
  return { gridRect, project };
}

describe("a page", () => {
  it("places Archie's page parts exactly where Archie draws them", () => {
    const layout = placeModalFrame(ARCHIE_PAGE.context, ARCHIE_PAGE.sizes);
    expect(layout.variant).toBe("page");
    expect(layout.card).toEqual(ARCHIE_PAGE.context.content);
    expect(layout.header).toEqual({ height: 63, width: 360, x: 0, y: 40 });
    expect(layout.title).toEqual(ARCHIE.title);
    expect(layout.body).toEqual(ARCHIE.region);
    expect(layout.bodyInset).toEqual({ bottom: 0, left: 8, right: 8, top: 0 });
    expect(layout.footer).toEqual({ height: 48, width: 344, x: 8, y: 500 });
    expect(layout.scrolls).toBe(true);
    expect(layout.close).toBeUndefined();
    const footer = layout.footer!;
    // Back's width follows its label's ink; Archie centres it across the padded page.
    for (const width of [128, 49, 75, 96, 327]) {
      const size = { height: 48, width };
      const [archie] = arrangeActions(
        { axis: "row", pressOverlap: "nearest", width: 360 - 2 * 16 },
        [{ key: "back", role: "primary", size }],
      ).actions;
      const [back] = arrangeActions({ origin: footer, variant: "footer", width: footer.width }, [
        { key: "back", role: "primary", size },
      ]).actions;
      expect(back).toMatchObject({
        face: { ...size, x: 16 + (archie as { face: Rect }).face.x, y: 500 },
      });
    }
    expect(
      arrangeActions({ origin: footer, variant: "footer", width: footer.width }, [
        { key: "back", role: "primary", size: { height: 48, width: 128 } },
      ]).actions[0],
    ).toMatchObject({ face: ARCHIE.back });
  });

  it.each([
    { dpr: 1, origin: { x: 0, y: 0 }, unit: 1 },
    { dpr: 2, origin: { x: 10.25, y: 3.5 }, unit: 1.5 },
    { dpr: 3, origin: { x: 0, y: 17.4 }, unit: 2.1 },
    { dpr: 2.625, origin: { x: 41.3, y: 0.7 }, unit: 1.17 },
  ])("lands on Archie's device grid at $unit units and DPR $dpr", (scale) => {
    const { gridRect, project } = archieGrid(scale);
    const layout = placeModalFrame({ ...ARCHIE_PAGE.context, project }, ARCHIE_PAGE.sizes);
    expect(layout.title).toEqual(gridRect(ARCHIE.title));
    expect(layout.body).toEqual(gridRect(ARCHIE.region));
    expect(layout.card).toEqual(gridRect(ARCHIE_PAGE.context.content));
    const unprojected = placeModalFrame(ARCHIE_PAGE.context, ARCHIE_PAGE.sizes).footer!;
    const [back] = arrangeActions(
      { origin: unprojected, project, variant: "footer", width: unprojected.width },
      [{ key: "back", role: "primary", size: { height: 48, width: 128 } }],
    ).actions;
    expect(back).toMatchObject({ face: gridRect(ARCHIE.back) });
  });

  it("takes no width family", () => {
    expect(() =>
      modalFrameRooms({ ...ARCHIE_PAGE.context, families: WIDE, family: "medium" }),
    ).toThrow(RangeError);
  });
});

describe("insets, an untitled frame and a placed backdrop", () => {
  it("defaults each inset to the padding", () => {
    const sizes = { body: 30, footer: 48, title: { height: 20 } };
    expect(placeModalFrame(card({ insets: { bottom: 16, side: 16 } }), sizes)).toEqual(
      placeModalFrame(card(), sizes),
    );
    expect(modalFrameRooms(card({ insets: { side: 4 } }))).toEqual({
      body: 492,
      card: 500,
      footer: 492,
      title: 468,
    });
    const open = placeModalFrame(card({ insets: { bottom: 6 } }), { body: 30 });
    expect(open.bodyInset.bottom).toBe(6);
    expect(open.body.height).toBe(36);
    expect(() => modalFrameRooms(card({ insets: { side: 1.5 } }))).toThrow(RangeError);
    expect(() => modalFrameRooms(card({ insets: { bottom: -1 } }))).toThrow(RangeError);
  });

  it("gives a frame without a title the padding or the close clearance as its header", () => {
    const plain = placeModalFrame(card(), { body: 40 });
    expect(plain.header.height).toBe(16);
    expect(plain.body.y).toBe(plain.card.y + 16);
    expect(plain.title).toEqual({
      height: 0,
      width: 468,
      x: plain.card.x + 16,
      y: plain.card.y + 8,
    });
    const closeable = placeModalFrame(card({ close: WIDE_CLOSE }), { body: 40, bodyOutset: 12 });
    // The target's bottom is 42 below the card's top: 42 + 8 + 12.
    expect(closeable.header.height).toBe(62);
  });

  it("places a backdrop independent of the content rect", () => {
    const backdrop = { height: 600, width: 1200, x: -120, y: -30 };
    expect(placeModalFrame(card(), { body: 0 }).backdrop).toBeUndefined();
    const layout = placeModalFrame(
      card({ backdrop, project: { x: (edge) => 2 * edge, y: (edge) => 2 * edge } }),
      { body: 0 },
    );
    expect(layout.backdrop).toEqual({ height: 1200, width: 2400, x: -240, y: -60 });
    expect(() =>
      placeModalFrame(card({ backdrop: { ...backdrop, width: 0 } }), { body: 0 }),
    ).toThrow(RangeError);
    expect(() => placeModalFrame(card({ backdrop: { ...backdrop, x: 0.5 } }), { body: 0 })).toThrow(
      RangeError,
    );
  });
});
