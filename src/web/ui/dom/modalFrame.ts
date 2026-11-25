import type { ModalInputGate, ModalInputScope } from "../../../input/index.ts";
import {
  type ActionArrangement,
  MODAL_FRAME,
  type ModalFrameContext,
  type ModalFrameLayout,
  modalFrameRooms,
  type ModalTitleSize,
  placeModalFrame,
  textRoleClass,
} from "../../../ui/index.ts";
import {
  type ActionGroupView,
  createActionGroup,
  type DomAction,
  type DomActionGroupContext,
} from "./actionGroup.ts";
import { listenOutsideTaps, type PressGuard } from "./domPress.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import type { ModalLayer } from "./modalLayer.ts";
import { readUnit } from "./viewUnits.ts";

// The HTML modal frame (modalFrame.css): a full-area frame root holding the backdrop and the
// card, a role dialog element named by its title. The card holds a skin layer the game styles
// (a CSS face or the nine-slice .ui-frame), the header with the title, the scroll body with the
// game's content, the footer action group and the game's close control, last in focus order.
// layout() measures the parts and places them by the pure geometry in base px at --ui-unit, from
// the card's outer edge, so no part adds padding a game cancels. open() puts the card on top of
// the game's modal layer in dialog isolation, with the backdrop as its only outside target.

export const MODAL_FRAME_CLASS = "ui-modal-frame";
export const MODAL_BACKDROP_CLASS = "ui-modal-backdrop";
export const MODAL_CARD_CLASS = "ui-modal-card";
export const MODAL_SKIN_CLASS = "ui-modal-skin";
export const MODAL_HEADER_CLASS = "ui-modal-header";
export const MODAL_TITLE_CLASS = "ui-modal-title";
export const MODAL_BODY_CLASS = "ui-modal-body";
export const MODAL_CONTENT_CLASS = "ui-modal-content";
export const MODAL_TEXT_CLASS = "ui-modal-text";
export const MODAL_FOOTER_CLASS = "ui-modal-footer";
export const MODAL_CLOSE_CLASS = "ui-modal-close";

export interface ModalFrameOptions {
  // The card's id, which the title's (-title) and description's (-text) ids extend.
  readonly id: string;
  readonly title: string;
  // Body text before the game's content, which describes the dialog.
  readonly description?: string;
  // alertdialog for a card the player must answer.
  readonly role?: "alertdialog" | "dialog";
  // Classes added to the card, the skin layer and the title: the game's skin and type.
  readonly cardClassName?: string;
  readonly skinClassName?: string;
  readonly titleClassName?: string;
}

// The pure context less placement in other spaces: the DOM places in base px from the frame
// root's corner. content is the game's content rect in base px in the frame root.
export type DomModalFrameContext = Omit<ModalFrameContext, "project">;

export interface ModalFrameParts {
  // The game's close control, such as a createButton view's element. Required with
  // context.close and only then. The frame keeps it the card's last child.
  readonly close?: HTMLElement;
  // The footer's actions, direct children of footer.element. Omit for no footer.
  readonly footer?: {
    readonly actions: readonly DomAction[];
    readonly context?: Omit<DomActionGroupContext, "variant" | "width">;
  };
  // The title's insets and ink offset; its height is measured.
  readonly title?: Omit<ModalTitleSize, "height">;
  // The first body content's upward press outset (ModalFrameSizes.bodyOutset).
  readonly bodyOutset?: number;
}

export interface ModalFrameOpen {
  readonly layer: ModalLayer;
  // The game's one-layer dismissal, the same action as the close control: Escape, P, back and,
  // with outsideTap, a tap on the backdrop call it. It then calls the returned close. Undefined
  // for a card the player must answer.
  readonly close?: () => void;
  // The control focused on open, or undefined for the card itself.
  readonly focus?: HTMLElement;
  // The game's modal input gate: open() takes a scope on it for the frame's life.
  readonly input?: ModalInputGate;
  // Calls close for a tap on the backdrop (domPress listenOutsideTaps) under the input scope.
  // Requires close and input.
  readonly outsideTap?: {
    readonly tapMaxDistance: number;
    readonly tapGuard?: PressGuard["tapGuard"];
  };
  readonly restore?: () => HTMLElement | null | undefined;
}

export interface ModalFrameSession {
  // Takes the card off the layer, restores the focus to the opener and closes the input scope.
  // Calling it again does nothing.
  close(): void;
  readonly scope?: ModalInputScope;
}

export interface ModalFrameView {
  // The full-area root the game mounts in one of its modal layer root's children.
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  // The dialog element.
  readonly card: HTMLElement;
  readonly skin: HTMLElement;
  readonly header: HTMLElement;
  readonly title: HTMLElement;
  // The scroll viewport, and the content box inside it the game appends to.
  readonly body: HTMLElement;
  readonly content: HTMLElement;
  readonly footer: ActionGroupView;
  // Measures the title at its room, the content and the footer, then places every part. Throws
  // RangeError on invalid input, before any placement, and when the measured header and footer
  // exceed the room. Lay out again after the content, the title, the fonts or the content rect
  // change.
  layout(
    context: DomModalFrameContext,
    parts?: ModalFrameParts,
  ): { readonly footer?: ActionArrangement<HTMLElement>; readonly frame: ModalFrameLayout };
  setTitle(title: string): void;
  open(options: ModalFrameOpen): ModalFrameSession;
  dispose(): void;
}

const BOX = ["x", "y", "width", "height"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

type Box = Readonly<Record<(typeof BOX)[number], number>>;

// A rect's properties relative to an origin.
function box(name: string, origin: { x: number; y: number }, rect: Box): Record<string, number> {
  const local = { ...rect, x: rect.x - origin.x, y: rect.y - origin.y };
  return Object.fromEntries(BOX.map((field) => [`--ui-modal-${name}-${field}`, local[field]]));
}

function wholeHeight(element: HTMLElement, unit: number): number {
  // A rounding allowance keeps an exact length from rounding up a whole unit.
  return Math.max(0, Math.ceil(element.getBoundingClientRect().height / unit - 1e-6));
}

// Removes the frame's marks from a close control it placed, and takes it out of the card.
function releaseClose(close: HTMLElement): void {
  close.classList.remove(MODAL_CLOSE_CLASS);
  for (const name of [
    ...BOX.map((field) => `--ui-modal-close-${field}`),
    ...SIDES.map((side) => `--ui-modal-close-outset-${side}`),
  ]) {
    close.style.removeProperty(name);
  }
  if (close.parentElement?.classList.contains(MODAL_CARD_CLASS) === true) {
    close.remove();
  }
}

function addClasses(element: HTMLElement, className: string | undefined): void {
  for (const name of (className ?? "").split(/\s+/)) {
    if (name !== "") {
      element.classList.add(name);
    }
  }
}

export function createModalFrame(document: Document, options: ModalFrameOptions): ModalFrameView {
  if (!/^[A-Za-z][\w-]*$/.test(options.id)) {
    throw new RangeError("A modal frame id must be a letter then letters, digits, - or _");
  }
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const created = document.createElement(tag);
    created.className = className;
    return created;
  };
  const root = element("div", MODAL_FRAME_CLASS);
  const backdrop = element("div", MODAL_BACKDROP_CLASS);
  const card = element("section", MODAL_CARD_CLASS);
  addClasses(card, options.cardClassName);
  card.id = options.id;
  card.setAttribute("role", options.role ?? "dialog");
  card.setAttribute("aria-labelledby", `${options.id}-title`);
  const skin = element("div", MODAL_SKIN_CLASS);
  addClasses(skin, options.skinClassName);
  skin.setAttribute("aria-hidden", "true");
  const header = element("div", MODAL_HEADER_CLASS);
  const title = element("h2", `${MODAL_TITLE_CLASS} ${textRoleClass("heading")}`);
  addClasses(title, options.titleClassName);
  title.id = `${options.id}-title`;
  title.textContent = options.title;
  header.append(title);
  const body = element("div", MODAL_BODY_CLASS);
  const content = element("div", MODAL_CONTENT_CLASS);
  if (options.description !== undefined) {
    const text = element("p", `${MODAL_TEXT_CLASS} ${textRoleClass("body")}`);
    text.id = `${options.id}-text`;
    text.textContent = options.description;
    content.append(text);
    card.setAttribute("aria-describedby", text.id);
  }
  body.append(content);
  const footerSlot = element("div", MODAL_FOOTER_CLASS);
  const footer = createActionGroup(document);
  footerSlot.append(footer.element);
  card.append(skin, header, body, footerSlot);
  root.append(backdrop, card);
  let close: HTMLElement | undefined;
  let session: ModalFrameSession | undefined;
  let disposed = false;
  const assertLive = () => {
    if (disposed) {
      throw new Error("Modal frame has been disposed");
    }
  };
  const view: ModalFrameView = {
    backdrop,
    body,
    card,
    content,
    dispose() {
      if (disposed) {
        return;
      }
      session?.close();
      disposed = true;
      footer.dispose();
      if (close !== undefined) {
        releaseClose(close);
      }
    },
    element: root,
    footer,
    header,
    layout(context, parts = {}) {
      assertLive();
      if ((context.close === undefined) !== (parts.close === undefined)) {
        throw new RangeError("A modal close control needs its geometry, and geometry its control");
      }
      if (parts.close !== undefined && (parts.close === card || parts.close.contains(card))) {
        throw new RangeError("The close control must be the game's own element");
      }
      const rooms = modalFrameRooms(context);
      const inset = parts.footer === undefined ? (context.padding ?? MODAL_FRAME.padding) : 0;
      const sizes = {
        ...(parts.bodyOutset === undefined ? {} : { bodyOutset: parts.bodyOutset }),
        title: { ...parts.title, height: 0 },
      };
      // Validates the parts before any change; the measured sizes are whole by construction.
      placeModalFrame(context, { ...sizes, body: 0 });
      const arrangement =
        parts.footer === undefined
          ? undefined
          : footer.arrange(
              { ...parts.footer.context, variant: "footer", width: rooms.footer },
              parts.footer.actions,
            );
      // The widths and insets first, so the title wraps and the content flows at their rooms.
      writeLayoutProperties(
        {
          "--ui-modal-body-width": rooms.card,
          "--ui-modal-card-width": rooms.card,
          "--ui-modal-inset-bottom": inset,
          "--ui-modal-inset-side": context.padding ?? MODAL_FRAME.padding,
          "--ui-modal-title-width": rooms.title,
        },
        card,
      );
      const unit = readUnit(card);
      const frame = placeModalFrame(context, {
        ...sizes,
        body: Math.max(0, wholeHeight(content, unit) - inset),
        title: { ...parts.title, height: wholeHeight(title, unit) },
        ...(arrangement === undefined ? {} : { footer: arrangement.group.height }),
      });
      if (close !== undefined && close !== parts.close) {
        releaseClose(close);
      }
      close = parts.close;
      const origin = frame.card;
      writeLayoutProperties(
        {
          ...box("card", { x: 0, y: 0 }, frame.card),
          ...box("header", origin, frame.header),
          ...box("title", frame.header, frame.title),
          ...box("body", origin, frame.body),
          ...(frame.footer === undefined ? {} : box("footer", origin, frame.footer)),
        },
        card,
      );
      card.setAttribute("data-ui-modal-variant", frame.variant);
      card.toggleAttribute("data-ui-modal-scrolls", frame.scrolls);
      card.toggleAttribute("data-ui-modal-footer", frame.footer !== undefined);
      if (close !== undefined && frame.close !== undefined) {
        close.classList.add(MODAL_CLOSE_CLASS);
        if (card.lastElementChild !== close) {
          card.append(close);
        }
        const { outset } = frame.close;
        writeLayoutProperties(
          {
            ...box("close", origin, frame.close.face),
            ...Object.fromEntries(
              SIDES.map((side) => [`--ui-modal-close-outset-${side}`, outset[side]]),
            ),
          },
          close,
        );
      }
      return { ...(arrangement === undefined ? {} : { footer: arrangement }), frame };
    },
    open(openOptions) {
      assertLive();
      if (session !== undefined) {
        throw new Error("Modal frame is already open");
      }
      const { input, layer, outsideTap } = openOptions;
      if (outsideTap !== undefined && (openOptions.close === undefined || input === undefined)) {
        throw new RangeError("Outside taps need the frame's close and an input gate");
      }
      const closeLayer = layer.open(
        {
          backdrop,
          isolation: "dialog",
          ...(openOptions.close === undefined ? {} : { close: openOptions.close }),
          ...(openOptions.focus === undefined ? {} : { focus: openOptions.focus }),
          ...(openOptions.restore === undefined ? {} : { restore: openOptions.restore }),
        },
        card,
      );
      const scope = input?.open();
      const stopTaps =
        outsideTap === undefined || scope === undefined
          ? undefined
          : listenOutsideTaps(
              {
                gate: scope,
                ...(outsideTap.tapGuard === undefined ? {} : { tapGuard: outsideTap.tapGuard }),
              },
              outsideTap.tapMaxDistance,
              openOptions.close!,
              backdrop,
            );
      let open = true;
      const opened: ModalFrameSession = {
        close() {
          if (!open) {
            return;
          }
          open = false;
          session = undefined;
          stopTaps?.();
          closeLayer();
          scope?.close();
        },
        ...(scope === undefined ? {} : { scope }),
      };
      session = opened;
      return opened;
    },
    setTitle(text) {
      assertLive();
      title.textContent = text;
    },
    skin,
    title,
  };
  return view;
}
