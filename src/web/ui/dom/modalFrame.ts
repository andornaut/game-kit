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
import { focusTarget } from "./focusModality.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import type { ModalLayer } from "./modalLayer.ts";
import { readUnit } from "./viewUnits.ts";

// The HTML modal frame (modalFrame.css): a full-area frame root holding the backdrop and the
// card, a role dialog element named by its title or label. The card holds a skin layer the game
// styles (a CSS face or the nine-slice .ui-frame), the header with the title, the scroll body with
// the game's content, the footer slot with the footer action group or the game's own footer, and
// the game's close control, last in focus order. layout() measures the parts and places them by
// the pure geometry in base px at --ui-unit, or in CSS px on the game's grid through its
// projection, from the card's outer edge, so no part adds padding a game cancels. open() puts a
// card or full-screen frame on top of the game's modal layer in dialog isolation, with the
// backdrop as its only outside target; a page opens without isolation and its backdrop is hidden.

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
  // The title, which names the dialog; omit for a frame without one, named by label.
  readonly title?: string;
  // The accessible name (aria-label) of a frame without a title, and only then.
  readonly label?: string;
  // Body text before the game's content, which describes the dialog.
  readonly description?: string;
  // alertdialog for a card the player must answer.
  readonly role?: "alertdialog" | "dialog";
  // Classes added to the card, the skin layer and the title: the game's skin and type.
  readonly cardClassName?: string;
  readonly skinClassName?: string;
  readonly titleClassName?: string;
}

// The pure context. content and backdrop are in base px from the frame root's corner, or with
// project in the game's units, which project maps to CSS px from that corner.
export type DomModalFrameContext = ModalFrameContext;

export interface ModalFrameParts {
  // The game's close control, such as a createButton view's element. Required with
  // context.close and only then. The frame keeps it the card's last child.
  readonly close?: HTMLElement;
  // The footer's actions, direct children of footer.element, or the game's own footer: its height
  // in units, its content in footerSlot. Omit for no footer.
  readonly footer?:
    | {
        readonly actions: readonly DomAction[];
        readonly context?: Omit<DomActionGroupContext, "variant" | "width">;
      }
    | { readonly height: number };
  // The title's insets and ink offset, and its height in units where the game owns its content
  // (measured otherwise). Titled frames only.
  readonly title?: Omit<ModalTitleSize, "height"> & { readonly height?: number };
  // The body content's natural height in units, without the body's insets; measured if omitted.
  readonly body?: number;
  // The first body content's upward press outset (ModalFrameSizes.bodyOutset).
  readonly bodyOutset?: number;
  // native: the body scrolls its content. game: it neither scrolls nor clips and takes no pan
  // gestures; the game moves and clips its content. Default native.
  readonly scroll?: "game" | "native";
}

export interface ModalFrameOpen {
  // The game's modal layer. Required for a card or full-screen frame; a page takes none.
  readonly layer?: ModalLayer;
  // The game's one-layer dismissal, the same action as the close control: Escape, P, back and,
  // with outsideTap, a tap on the backdrop call it. It then calls the returned close. Undefined
  // for a card the player must answer. Not for a page.
  readonly close?: () => void;
  // The control focused on open, or undefined for the card itself.
  readonly focus?: HTMLElement;
  // The game's modal input gate: open() takes a scope on it for the frame's life.
  readonly input?: ModalInputGate;
  // Calls close for a tap on the backdrop (domPress listenOutsideTaps) under the input scope.
  // Requires close and input. Not for a page.
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
  // Hidden on a frame without a title.
  readonly title: HTMLElement;
  // The scroll viewport, and the content box inside it the game appends to.
  readonly body: HTMLElement;
  readonly content: HTMLElement;
  // The footer action group. Its measure() shows the footer while it measures, so it works
  // before the first layout.
  readonly footer: ActionGroupView;
  // The footer's room, which holds the action group or the game's own footer.
  readonly footerSlot: HTMLElement;
  // Measures the title at its room, the content and the footer, then places every part. Throws
  // RangeError on invalid input, before any placement, and when the measured header and footer
  // exceed the room. Lay out again after the content, the title, the fonts or the content rect
  // change. units is the layout before projection (frame itself without one), for placing the
  // game's own title and footer content.
  layout(
    context: DomModalFrameContext,
    parts?: ModalFrameParts,
  ): {
    readonly footer?: ActionArrangement<HTMLElement>;
    readonly frame: ModalFrameLayout;
    readonly units: ModalFrameLayout;
  };
  setTitle(title: string): void;
  // Opens the frame as last laid out: a page without the modal layer, anything else on it.
  open(options: ModalFrameOpen): ModalFrameSession;
  dispose(): void;
}

const BOX = ["x", "y", "width", "height"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;
const MEASURING = "data-ui-modal-measuring";

type Box = Readonly<Record<(typeof BOX)[number], number>>;

// A rect's properties relative to an origin.
function box(name: string, origin: { x: number; y: number }, rect: Box): Record<string, number> {
  const local = { ...rect, x: rect.x - origin.x, y: rect.y - origin.y };
  return Object.fromEntries(BOX.map((field) => [`--ui-modal-${name}-${field}`, local[field]]));
}

function removeProperties(element: HTMLElement, names: readonly string[]): void {
  for (const name of names) {
    element.style.removeProperty(name);
  }
}

function wholeHeight(element: HTMLElement, unit: number): number {
  // A rounding allowance keeps an exact length from rounding up a whole unit.
  return Math.max(0, Math.ceil(element.getBoundingClientRect().height / unit - 1e-6));
}

// Removes the frame's marks from a close control it placed, and takes it out of the card.
function releaseClose(close: HTMLElement): void {
  close.classList.remove(MODAL_CLOSE_CLASS);
  removeProperties(close, [
    ...BOX.map((field) => `--ui-modal-close-${field}`),
    ...SIDES.map((side) => `--ui-modal-close-outset-${side}`),
  ]);
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

// Whether the focus can go back to element: connected, focusable and not hidden or inert.
function usable(element: Element | null | undefined): element is HTMLElement {
  return (
    element !== null &&
    element !== undefined &&
    element.isConnected &&
    "focus" in element &&
    element.closest("[hidden], [inert]") === null
  );
}

export function createModalFrame(document: Document, options: ModalFrameOptions): ModalFrameView {
  if (!/^[A-Za-z][\w-]*$/.test(options.id)) {
    throw new RangeError("A modal frame id must be a letter then letters, digits, - or _");
  }
  const titled = options.title !== undefined;
  if (titled === (options.label !== undefined) || options.label?.trim() === "") {
    throw new RangeError("A modal frame takes a title or, without one, a nonempty label");
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
  const skin = element("div", MODAL_SKIN_CLASS);
  addClasses(skin, options.skinClassName);
  skin.setAttribute("aria-hidden", "true");
  const header = element("div", MODAL_HEADER_CLASS);
  const title = element("h2", `${MODAL_TITLE_CLASS} ${textRoleClass("heading")}`);
  addClasses(title, options.titleClassName);
  if (options.title === undefined) {
    card.setAttribute("aria-label", options.label!);
    title.hidden = true;
  } else {
    card.setAttribute("aria-labelledby", `${options.id}-title`);
    title.id = `${options.id}-title`;
    title.textContent = options.title;
  }
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
  const group = createActionGroup(document);
  // The footer shows while its actions are measured, even before it is laid out.
  const footer: ActionGroupView = {
    ...group,
    measure(elements) {
      card.setAttribute(MEASURING, "");
      try {
        return group.measure(elements);
      } finally {
        card.removeAttribute(MEASURING);
      }
    },
  };
  footerSlot.append(group.element);
  card.append(skin, header, body, footerSlot);
  root.append(backdrop, card);
  let close: HTMLElement | undefined;
  let session: ModalFrameSession | undefined;
  let laidOut: ModalFrameLayout["variant"] | undefined;
  let hidBackdrop = false;
  let disposed = false;
  const assertLive = () => {
    if (disposed) {
      throw new Error("Modal frame has been disposed");
    }
  };
  const openPage = (openOptions: ModalFrameOpen): ModalFrameSession => {
    if (
      openOptions.layer !== undefined ||
      openOptions.close !== undefined ||
      openOptions.outsideTap !== undefined
    ) {
      throw new RangeError("A page opens without the modal layer, a dismissal or outside taps");
    }
    const opener = document.activeElement;
    if (!card.hasAttribute("tabindex")) {
      card.tabIndex = -1;
    }
    focusTarget(openOptions.focus ?? card);
    const scope = openOptions.input?.open();
    let open = true;
    return {
      close() {
        if (!open) {
          return;
        }
        open = false;
        session = undefined;
        scope?.close();
        // Live chrome the player moved the focus to keeps it.
        const active = document.activeElement;
        if (active !== null && active !== document.body && !card.contains(active)) {
          return;
        }
        if (usable(opener)) {
          focusTarget(opener);
          return;
        }
        const fallback = openOptions.restore?.();
        if (usable(fallback)) {
          focusTarget(fallback);
        }
      },
      ...(scope === undefined ? {} : { scope }),
    };
  };
  const openModal = (openOptions: ModalFrameOpen): ModalFrameSession => {
    const { input, layer, outsideTap } = openOptions;
    if (layer === undefined) {
      throw new RangeError("A modal frame opens on the game's modal layer");
    }
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
    return {
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
      group.dispose();
      if (close !== undefined) {
        releaseClose(close);
      }
    },
    element: root,
    footer,
    footerSlot,
    header,
    layout(context, parts = {}) {
      assertLive();
      if ((context.close === undefined) !== (parts.close === undefined)) {
        throw new RangeError("A modal close control needs its geometry, and geometry its control");
      }
      if (parts.close !== undefined && (parts.close === card || parts.close.contains(card))) {
        throw new RangeError("The close control must be the game's own element");
      }
      if (!titled && parts.title !== undefined) {
        throw new RangeError("A modal frame without a title takes no title sizes");
      }
      if (parts.scroll !== undefined && parts.scroll !== "native" && parts.scroll !== "game") {
        throw new RangeError("Unknown modal body scroll");
      }
      const { height: givenTitle, ...titleRest } = parts.title ?? {};
      const owned =
        parts.footer !== undefined && "height" in parts.footer ? parts.footer : undefined;
      const { project } = context;
      if (
        project !== undefined &&
        ((titled && givenTitle === undefined) ||
          parts.body === undefined ||
          (parts.footer !== undefined && owned === undefined))
      ) {
        throw new RangeError(
          "A projected modal frame takes its title and body heights and its own footer from the game",
        );
      }
      if (session !== undefined && (laidOut === "page") !== (context.variant === "page")) {
        throw new RangeError("An open modal frame cannot change between a page and a modal");
      }
      const rooms = modalFrameRooms(context);
      const padding = context.padding ?? MODAL_FRAME.padding;
      const side = context.insets?.side ?? padding;
      const inset = parts.footer === undefined ? (context.insets?.bottom ?? padding) : 0;
      const sizes = (title: number, body: number, footerHeight: number | undefined) => ({
        ...(parts.bodyOutset === undefined ? {} : { bodyOutset: parts.bodyOutset }),
        body,
        ...(footerHeight === undefined ? {} : { footer: footerHeight }),
        ...(titled ? { title: { ...titleRest, height: title } } : {}),
      });
      // Validates the parts before any change; the measured sizes are whole by construction.
      placeModalFrame(context, sizes(givenTitle ?? 0, parts.body ?? 0, owned?.height));
      const arrangement =
        parts.footer === undefined || "height" in parts.footer
          ? undefined
          : group.arrange(
              { ...parts.footer.context, variant: "footer", width: rooms.footer },
              parts.footer.actions,
            );
      // The widths and insets first, so the title wraps and the content flows at their rooms.
      if (project === undefined) {
        writeLayoutProperties(
          {
            "--ui-modal-body-width": rooms.card,
            "--ui-modal-card-width": rooms.card,
            "--ui-modal-inset-bottom": inset,
            "--ui-modal-inset-side": side,
            "--ui-modal-title-width": rooms.title,
          },
          card,
        );
      }
      const unit = project === undefined ? readUnit(card) : 1;
      const placed = sizes(
        givenTitle ?? (titled ? wholeHeight(title, unit) : 0),
        parts.body ?? Math.max(0, wholeHeight(content, unit) - inset),
        owned?.height ?? arrangement?.group.height,
      );
      const frame = placeModalFrame(context, placed);
      const units =
        project === undefined
          ? frame
          : placeModalFrame({ ...context, project: { x: (x) => x, y: (y) => y } }, placed);
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
      // A game-owned title's box is as tall as the title; a measured one is its text's height.
      if (givenTitle === undefined) {
        card.style.removeProperty("--ui-modal-title-height");
      } else {
        writeLayoutProperties({ "--ui-modal-title-height": frame.title.height }, card);
      }
      // Projected insets, each side its own edges' distance on the game's grid.
      const sides = ["--ui-modal-inset-left", "--ui-modal-inset-right"];
      if (project === undefined) {
        removeProperties(card, sides);
      } else {
        const { body: unitBody, bodyInset } = units;
        const right = unitBody.x + unitBody.width;
        const end = unitBody.y + unitBody.height;
        writeLayoutProperties(
          {
            "--ui-modal-inset-bottom": project.y(end) - project.y(end - bodyInset.bottom),
            "--ui-modal-inset-left": project.x(unitBody.x + bodyInset.left) - project.x(unitBody.x),
            "--ui-modal-inset-right": project.x(right) - project.x(right - bodyInset.right),
          },
          card,
        );
      }
      root.toggleAttribute("data-ui-modal-projected", project !== undefined);
      if (frame.backdrop === undefined) {
        backdrop.removeAttribute("data-ui-modal-placed");
        removeProperties(
          backdrop,
          BOX.map((field) => `--ui-modal-backdrop-${field}`),
        );
      } else {
        writeLayoutProperties(box("backdrop", { x: 0, y: 0 }, frame.backdrop), backdrop);
        backdrop.setAttribute("data-ui-modal-placed", "");
      }
      // A page leaves covered chrome live, so it has no backdrop.
      if (frame.variant === "page") {
        hidBackdrop ||= !backdrop.hidden;
        backdrop.hidden = true;
      } else if (hidBackdrop) {
        hidBackdrop = false;
        backdrop.hidden = false;
      }
      laidOut = frame.variant;
      card.setAttribute("data-ui-modal-variant", frame.variant);
      card.toggleAttribute("data-ui-modal-scrolls", frame.scrolls);
      card.toggleAttribute("data-ui-modal-footer", frame.footer !== undefined);
      if (parts.scroll === "game") {
        card.setAttribute("data-ui-modal-scroll", "game");
      } else {
        card.removeAttribute("data-ui-modal-scroll");
      }
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
      return { ...(arrangement === undefined ? {} : { footer: arrangement }), frame, units };
    },
    open(openOptions) {
      assertLive();
      if (session !== undefined) {
        throw new Error("Modal frame is already open");
      }
      session = laidOut === "page" ? openPage(openOptions) : openModal(openOptions);
      return session;
    },
    setTitle(text) {
      assertLive();
      if (!titled) {
        throw new Error("A modal frame without a title has none to set");
      }
      title.textContent = text;
    },
    skin,
    title,
  };
  return view;
}
