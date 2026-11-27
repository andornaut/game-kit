import { MODAL_CONTENT } from "../../modalLayout.ts";
import type { Rect } from "../../rect.ts";
import type { ActionOutset } from "../actions/actionGroup.ts";
import { HIT_RULE, hitMargin } from "../actions/hitAreas.ts";
import { type ActionProjection, IDENTITY_PROJECTION, projectRect } from "../projection.ts";

// Modal frames: a card centred in the game's content rect at a width family's width, or a
// full-screen view or non-modal page that is the content rect itself, with a header holding an
// optional centred title and an optional close control, a scroll body and an optional pinned
// footer. Every input and output is a whole game unit, and every length is measured from the
// card's outer edge, so a skin (a CSS face or nine-slice art) never moves the content. Where a
// length splits unevenly the odd unit goes right or below: centring leaves it after the content.

// page: placed as fullScreen; the DOM frame opens it without modal isolation.
export type ModalFrameVariant = "card" | "fullScreen" | "page";

// Width families by name, in whole units: the game's own, such as { large: 688, medium: 500,
// small: 400 }.
export type ModalWidthFamilies = Readonly<Record<string, number>>;

// A rect placed from its container's top-right corner: x is the distance in from the right edge
// to the rect's right side and y the distance down from the top edge. Negative values reach past
// the edge.
export interface CornerRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface ModalClose {
  // The drawn face, from the card's corner (or the view's, full screen).
  readonly face: CornerRect;
  // The press target, which must contain the face. Default: centred on the face by HIT_RULE, its
  // margin rounded up and grown to minTarget, the odd unit right and below. It is never clamped
  // or shifted to fit the card: it may reach past the card's edge.
  readonly press?: CornerRect;
}

// Insets from the frame's edges, each defaulting to the padding.
export interface ModalFrameInsets {
  // Between the frame's bottom and the footer, or without a footer the body content's end.
  readonly bottom?: number;
  // Between the frame's sides and the body content and the footer.
  readonly side?: number;
}

export interface ModalFrameContext {
  // The game's content rect, such as its safe play area, in whole units.
  readonly content: Rect;
  // The backdrop's rect in the same space, such as the whole screen past letterbox bars.
  // Default: the frame root's area, unplaced.
  readonly backdrop?: Rect;
  readonly variant?: ModalFrameVariant;
  // The card's width families and the one it takes. Card only.
  readonly families?: ModalWidthFamilies;
  readonly family?: string;
  readonly close?: ModalClose;
  // The gap below the close target and above a footer. Default 8.
  readonly gap?: number;
  // The least space between a card and the content rect's edges. Default 16. Card only.
  readonly margin?: number;
  // The space inside the card's edges around the title and, unless insets say otherwise, the
  // body and footer. Default MODAL_CONTENT.padding.
  readonly padding?: number;
  readonly insets?: ModalFrameInsets;
  readonly project?: ActionProjection;
}

export interface ModalTitleSize {
  // The title box's height at its room's width: data, or the measured wrapped text.
  readonly height: number;
  // The space above and below the title box in the header. Default: the padding.
  readonly inset?: number;
  // Moves the title box down (or up, negative) from its centred place, for the game's ink
  // placement. Default 0.
  readonly inkOffset?: number;
}

export interface ModalFrameSizes {
  // The body content's natural height, without the body's insets.
  readonly body: number;
  // Omit for a frame without a title: its header is the padding or the close clearance.
  readonly title?: ModalTitleSize;
  // How far the first body content's press areas reach above it, so they clear the close target
  // by the gap. Default 0.
  readonly bodyOutset?: number;
  // The footer action group's height (arrangeActions group.height); omit for no footer.
  readonly footer?: number;
}

// The widths the game lays out its parts in: the card, the title box, the body content and the
// footer's room (arrangeActions context.width).
export interface ModalFrameRooms {
  readonly body: number;
  readonly card: number;
  readonly footer: number;
  readonly title: number;
}

export interface PlacedModalClose {
  readonly face: Rect;
  // The press target's reach past the face on each side, nonnegative.
  readonly outset: ActionOutset;
  readonly press: Rect;
}

export interface ModalFrameLayout {
  // With context.backdrop only.
  readonly backdrop?: Rect;
  // The body's scroll viewport; its content sits bodyInset in from its edges.
  readonly body: Rect;
  readonly bodyInset: ActionOutset;
  readonly card: Rect;
  readonly close?: PlacedModalClose;
  // The footer's room; its action group's box.
  readonly footer?: Rect;
  readonly header: Rect;
  // Whether the body content is taller than its viewport.
  readonly scrolls: boolean;
  // Without a title, an empty box centred in the header.
  readonly title: Rect;
  readonly variant: ModalFrameVariant;
}

export const MODAL_FRAME = {
  gap: 8,
  margin: 16,
  padding: MODAL_CONTENT.padding,
} as const;

function whole(name: string, value: number, least = 0): void {
  if (!Number.isInteger(value) || value < least) {
    throw new RangeError(`${name} must be a whole number of units, at least ${least}`);
  }
}

const ANY = Number.MIN_SAFE_INTEGER;

function wholeCorner(name: string, rect: CornerRect, least: number): void {
  whole(`${name}.x`, rect.x, ANY);
  whole(`${name}.y`, rect.y, ANY);
  whole(`${name}.width`, rect.width, least);
  whole(`${name}.height`, rect.height, least);
}

function defaultPress(face: CornerRect): CornerRect {
  const margin = Math.ceil(
    hitMargin(HIT_RULE, { height: face.height, width: face.width, x: 0, y: 0 }),
  );
  const grow = (length: number) => {
    const extra = Math.max(0, Math.ceil(HIT_RULE.minTarget) - (length + 2 * margin));
    return { after: margin + Math.ceil(extra / 2), before: margin + Math.floor(extra / 2) };
  };
  const across = grow(face.width);
  const down = grow(face.height);
  return {
    height: face.height + down.before + down.after,
    width: face.width + across.before + across.after,
    // x is measured from the right edge, so the reach past the face's right side subtracts.
    x: face.x - across.after,
    y: face.y - down.before,
  };
}

interface Resolved {
  readonly bottom: number;
  readonly close?: { readonly face: CornerRect; readonly press: CornerRect };
  readonly gap: number;
  readonly margin: number;
  readonly padding: number;
  readonly project: ActionProjection;
  readonly side: number;
  readonly variant: ModalFrameVariant;
  readonly width: number;
}

function resolve(context: ModalFrameContext): Resolved {
  const {
    content,
    gap = MODAL_FRAME.gap,
    margin = MODAL_FRAME.margin,
    padding = MODAL_FRAME.padding,
    project = IDENTITY_PROJECTION,
    variant = "card",
  } = context;
  if (variant !== "card" && variant !== "fullScreen" && variant !== "page") {
    throw new RangeError("Unknown modal frame variant");
  }
  whole("content.x", content.x, ANY);
  whole("content.y", content.y, ANY);
  whole("content.width", content.width, 1);
  whole("content.height", content.height, 1);
  whole("gap", gap);
  whole("margin", margin);
  whole("padding", padding);
  const { bottom = padding, side = padding } = context.insets ?? {};
  whole("insets.bottom", bottom);
  whole("insets.side", side);
  if (context.backdrop !== undefined) {
    const { backdrop } = context;
    whole("backdrop.x", backdrop.x, ANY);
    whole("backdrop.y", backdrop.y, ANY);
    whole("backdrop.width", backdrop.width, 1);
    whole("backdrop.height", backdrop.height, 1);
  }
  let width = content.width;
  if (variant === "card") {
    const { families, family } = context;
    if (families === undefined || family === undefined || !Object.hasOwn(families, family)) {
      throw new RangeError("A modal card needs its width families and one of their names");
    }
    whole(`families.${family}`, families[family]!, 1);
    width = Math.min(families[family]!, content.width - 2 * margin);
    if (width < 1) {
      throw new RangeError("The content rect leaves no room for a modal card inside its margin");
    }
  } else if (context.families !== undefined || context.family !== undefined) {
    throw new RangeError("A full-screen modal frame or page takes no width family");
  }
  let close: Resolved["close"];
  if (context.close !== undefined) {
    const { face } = context.close;
    wholeCorner("close.face", face, 1);
    const press = context.close.press ?? defaultPress(face);
    wholeCorner("close.press", press, 1);
    if (
      press.x > face.x ||
      press.y > face.y ||
      press.x + press.width < face.x + face.width ||
      press.y + press.height < face.y + face.height
    ) {
      throw new RangeError("The close press target must contain its face");
    }
    close = { face, press };
  }
  return {
    bottom,
    ...(close === undefined ? {} : { close }),
    gap,
    margin,
    padding,
    project,
    side,
    variant,
    width,
  };
}

// Each side's clearance of a centred title: the whole close target from the right edge plus the
// gap, mirrored on the left, or the padding without a close control.
function titleReserve(resolved: Resolved): number {
  const { close, gap, padding } = resolved;
  return close === undefined ? padding : Math.max(padding, close.press.x + close.press.width + gap);
}

// The widths of the frame's parts for context. Throws RangeError on invalid input or a title with
// no room between the close clearances.
export function modalFrameRooms(context: ModalFrameContext): ModalFrameRooms {
  const resolved = resolve(context);
  const { side, width } = resolved;
  const title = width - 2 * titleReserve(resolved);
  const inner = width - 2 * side;
  if (title < 1 || inner < 1) {
    throw new RangeError("The modal frame leaves no room for its title or body");
  }
  return { body: inner, card: width, footer: inner, title };
}

// Places the frame for its parts' sizes. A card is its family's width, clamped inside the margin,
// and as tall as its content up to the content rect's height less the margin above and below;
// past that its body scrolls. It is centred both ways in the content rect. A full-screen frame or
// page is the content rect, and its body takes the height the header and footer leave. The header
// is as tall as the title box and its insets (without a title, the padding), and at least reaches
// the gap (plus bodyOutset) below the close target; the title box is centred in it, inside the
// mirrored close clearance, then moved by inkOffset. The body runs from the header to the gap
// above the footer, or to the card's bottom with the bottom inset inside it; the footer sits the
// side inset in from the card's sides and the bottom inset up from its bottom.
// The close face and press target are placed from the card's top-right corner (full screen: the
// view's) exactly as given. Throws RangeError on invalid input or a header and footer taller than
// the room.
export function placeModalFrame(
  context: ModalFrameContext,
  sizes: ModalFrameSizes,
): ModalFrameLayout {
  const resolved = resolve(context);
  const rooms = modalFrameRooms(context);
  const { bottom, close, gap, margin, padding, project, side, variant } = resolved;
  const { content } = context;
  const { bodyOutset = 0, footer, title } = sizes;
  const { height: titleHeight = 0, inkOffset = 0, inset = padding } = title ?? {};
  whole("body", sizes.body);
  whole("bodyOutset", bodyOutset);
  whole("title.height", titleHeight);
  whole("title.inset", inset);
  whole("title.inkOffset", inkOffset, ANY);
  if (footer !== undefined) {
    whole("footer", footer);
  }
  const headerHeight = Math.max(
    title === undefined ? padding : titleHeight + 2 * inset,
    close === undefined ? 0 : close.press.y + close.press.height + gap + bodyOutset,
  );
  // Without a footer the bottom inset is inside the body, so its content scrolls through it.
  const bodyInset = {
    bottom: footer === undefined ? bottom : 0,
    left: side,
    right: side,
    top: 0,
  };
  const below = footer === undefined ? 0 : gap + footer + bottom;
  const natural = bodyInset.top + sizes.body + bodyInset.bottom;
  const room =
    (variant === "card" ? content.height - 2 * margin : content.height) - headerHeight - below;
  if (room < 0) {
    throw new RangeError("The modal frame's header and footer exceed its room");
  }
  const bodyHeight = variant === "card" ? Math.min(natural, room) : room;
  const height = headerHeight + bodyHeight + below;
  const card: Rect =
    variant === "card"
      ? {
          height,
          width: rooms.card,
          x: content.x + Math.floor((content.width - rooms.card) / 2),
          y: content.y + Math.floor((content.height - height) / 2),
        }
      : { ...content };
  const bodyTop = card.y + headerHeight;
  const corner = (rect: CornerRect): Rect => ({
    height: rect.height,
    width: rect.width,
    x: card.x + card.width - rect.x - rect.width,
    y: card.y + rect.y,
  });
  let placedClose: PlacedModalClose | undefined;
  if (close !== undefined) {
    const face = projectRect(project, corner(close.face));
    const press = projectRect(project, corner(close.press));
    placedClose = {
      face,
      outset: {
        bottom: press.y + press.height - (face.y + face.height),
        left: face.x - press.x,
        right: press.x + press.width - (face.x + face.width),
        top: face.y - press.y,
      },
      press,
    };
  }
  const reserve = titleReserve(resolved);
  return {
    ...(context.backdrop === undefined ? {} : { backdrop: projectRect(project, context.backdrop) }),
    body: projectRect(project, {
      height: bodyHeight,
      width: card.width,
      x: card.x,
      y: bodyTop,
    }),
    bodyInset,
    card: projectRect(project, card),
    ...(placedClose === undefined ? {} : { close: placedClose }),
    ...(footer === undefined
      ? {}
      : {
          footer: projectRect(project, {
            height: footer,
            width: rooms.footer,
            x: card.x + side,
            y: card.y + card.height - bottom - footer,
          }),
        }),
    header: projectRect(project, { height: headerHeight, width: card.width, x: card.x, y: card.y }),
    scrolls: natural > bodyHeight,
    title: projectRect(project, {
      height: titleHeight,
      width: rooms.title,
      x: card.x + reserve,
      y: card.y + Math.floor((headerHeight - titleHeight) / 2) + inkOffset,
    }),
    variant,
  };
}
