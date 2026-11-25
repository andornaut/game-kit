import { type FocusKeyAction, focusKeyAction, stepFocus } from "../../../ui/index.ts";
import { focusTarget, trackInputModality } from "./focusModality.ts";

// One modal layer shared by every card a game opens over its UI root. The top modal alone takes
// the keyboard: Tab and the arrows step the focus through its controls, then its live elements',
// wrapping and trapped in them; Enter and Space click the focused control once per press; Escape
// and P close a closeable card (ui/focusKeys). It marks the card aria-modal, makes the rest of the
// root inert apart from the card's layer and live elements by default. Dialog isolation keeps
// only its subtree and the exact caller backdrop interactive. It focuses the default action on
// open and restores the focus on close. It moves the focus through focusTarget (focusModality),
// so the ring shows only after keyboard input, and tracks the document's input modality from its
// creation. It does not use <dialog>.showModal() or popover: the top layer renders outside a
// turned page frame.

export interface ModalOptions {
  // Dialog mode isolates its subtree; only the exact backdrop may take outside pointer input.
  // Backdrop requires dialog mode. The default layer mode retains its existing live regions.
  readonly isolation?: "layer" | "dialog";
  readonly backdrop?: HTMLElement;
  // Closes the card on Escape, P or back: the game's own close, which then calls the close
  // returned by open. Undefined for a card the player cannot close.
  readonly close?: () => void;
  // The control focused on open, or undefined for the card itself.
  readonly focus?: HTMLElement;
  // Elements under root, outside the card's layer, that stay live while the card is on top. They
  // take presses, and the card's keys reach them: Tab and the arrows step on from the card's
  // controls through each one's, in this order, and Enter and Space click the one focused. Inert
  // goes on the siblings along the path from root to each, so one may sit inside another layer.
  readonly live?: readonly HTMLElement[];
  // Where the focus goes on close when the element focused before open is gone, hidden or inert.
  readonly restore?: () => HTMLElement | null | undefined;
}

export interface ModalLayer {
  // Closes the top card as Escape does, for the game's back handler. Returns whether a card was
  // open, even one the player cannot close, so back stays on it.
  back(): boolean;
  // Removes the layer's listeners and every inert mark it set.
  dispose(): void;
  // Opens dialog, inside one of root's child layers, on top. The returned close takes it off the
  // stack and restores the focus; calling it again does nothing.
  open(options: ModalOptions, dialog: HTMLElement): () => void;
}

interface OpenModal {
  readonly dialog: HTMLElement;
  readonly opener: Element | null;
  readonly options: ModalOptions;
  readonly strict: boolean;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(", ");

const reachable = (element: HTMLElement) =>
  element.tabIndex >= 0 && element.closest("[hidden], [inert]") === null;

// The controls Tab reaches in dialog, in document order: focusable, not tabindex -1 and not in a
// hidden or inert subtree.
export function focusTargets(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
}

// The controls the card's keys step through: the card's, then each live element's, the element
// itself first where it is one.
function modalTargets(modal: OpenModal): HTMLElement[] {
  return [
    ...focusTargets(modal.dialog),
    ...(modal.options.live ?? []).flatMap((element) => [
      ...(element.matches(FOCUSABLE) && reachable(element) ? [element] : []),
      ...focusTargets(element),
    ]),
  ];
}

// Whether node is in the card or in one of its live elements.
function within(modal: OpenModal, node: Node | null): boolean {
  return [modal.dialog, ...(modal.options.live ?? [])].some((element) => element.contains(node));
}

function usable(element: Element | null): element is HTMLElement {
  return (
    element !== null &&
    element.isConnected &&
    "focus" in element &&
    element.closest("[hidden], [inert]") === null
  );
}

// The elements to make inert under root while the card in layer is on top with live elements:
// root's other children, and along the path from root to each live element, its ancestors'
// other children.
function inertTargets(
  root: HTMLElement,
  layer: Element | undefined,
  live: readonly Element[],
  pathsOnly: readonly Element[] = [],
): Set<Element> {
  const kept = new Set<Element>();
  const paths = new Set<Element>();
  for (const element of live) {
    if (element !== root && root.contains(element)) {
      kept.add(element);
      let parent = element.parentElement;
      while (parent !== null && parent !== root) {
        paths.add(parent);
        parent = parent.parentElement;
      }
    }
  }
  if (layer !== undefined) {
    kept.add(layer);
  }
  for (const element of pathsOnly) {
    if (element !== root && root.contains(element)) {
      let path: Element | null = element;
      while (path !== null && path !== root) {
        paths.add(path);
        path = path.parentElement;
      }
    }
  }
  const targets = new Set<Element>();
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (kept.has(child)) {
        continue;
      }
      if (paths.has(child)) {
        visit(child);
      } else {
        targets.add(child);
      }
    }
  };
  visit(root);
  return targets;
}

// The modal layer over root, whose element children are the game's UI layers.
export function createModalLayer(root: HTMLElement): ModalLayer {
  const document = root.ownerDocument;
  // From creation, so a key pressed before the first card opens counts; the layer's dispose
  // leaves it, since the tracking is the document's.
  trackInputModality(document);
  const stack: OpenModal[] = [];
  const inerted = new Set<Element>();
  let disposed = false;
  let observer: MutationObserver | undefined;
  let observed: OpenModal | undefined;
  let applying = false;
  let refreshAgain = false;
  const top = () => stack.at(-1);
  const layerOf = (dialog: HTMLElement) =>
    [...root.children].find((child) => child.contains(dialog));
  const owned = (allowRoot: boolean, element: unknown): element is HTMLElement =>
    element instanceof (document.defaultView?.HTMLElement ?? HTMLElement) &&
    element.ownerDocument === document &&
    root.isConnected &&
    element.isConnected &&
    root.contains(element) &&
    (allowRoot || element !== root);
  const obstructed = (element: Element) => {
    for (
      let ancestor: Element | null = element;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      if (
        ancestor.hasAttribute("hidden") ||
        (ancestor.hasAttribute("inert") && !inerted.has(ancestor))
      ) {
        return true;
      }
    }
    return false;
  };
  const strictState = (modal: OpenModal) => {
    const { backdrop } = modal.options;
    return {
      backdrop:
        backdrop === undefined ||
        (owned(true, backdrop) && !modal.dialog.contains(backdrop) && !obstructed(backdrop)),
      dialog: owned(false, modal.dialog) && !obstructed(modal.dialog),
    };
  };
  const prepare = (options: ModalOptions, dialog: HTMLElement): ModalOptions => {
    if (
      options.isolation !== undefined &&
      options.isolation !== "layer" &&
      options.isolation !== "dialog"
    ) {
      throw new RangeError("Unknown modal isolation mode");
    }
    if (options.isolation !== "dialog") {
      if (options.backdrop !== undefined) {
        throw new RangeError("Modal backdrop requires dialog isolation");
      }
      return options;
    }
    const snapshot = { ...options, isolation: "dialog" as const };
    if (
      disposed ||
      !owned(false, dialog) ||
      obstructed(dialog) ||
      stack.some((modal) => dialog.contains(modal.dialog)) ||
      (snapshot.live !== undefined &&
        (!Array.isArray(snapshot.live) || snapshot.live.length !== 0)) ||
      (snapshot.backdrop !== undefined &&
        (!owned(true, snapshot.backdrop) ||
          dialog.contains(snapshot.backdrop) ||
          obstructed(snapshot.backdrop))) ||
      (snapshot.focus !== undefined &&
        (!owned(false, snapshot.focus) ||
          !dialog.contains(snapshot.focus) ||
          obstructed(snapshot.focus)))
    ) {
      throw new RangeError("Invalid dialog isolation ownership, focus or live configuration");
    }
    return { ...snapshot, live: [] };
  };
  const syncObserver = () => {
    const modal = top();
    const next = !disposed && modal?.strict === true ? modal : undefined;
    if (next === observed) {
      return;
    }
    observer?.disconnect();
    observer = undefined;
    observed = next;
    if (next !== undefined) {
      observer = new (document.defaultView?.MutationObserver ?? MutationObserver)(() => {
        if (!disposed && observed === next && top() === next) {
          applyInert();
          if (
            !disposed &&
            observed === next &&
            top() === next &&
            !within(next, document.activeElement)
          ) {
            focusOpen(next);
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }
  };
  // Marks what the top card needs inert and clears the marks it set that the card no longer
  // needs, never touching an element the game made inert.
  const applyInert = () => {
    if (applying) {
      refreshAgain = true;
      return;
    }
    applying = true;
    try {
      do {
        refreshAgain = false;
        const modal = top();
        const state = modal?.strict === true ? strictState(modal) : undefined;
        const targets =
          modal === undefined
            ? new Set<Element>()
            : state === undefined
              ? inertTargets(root, layerOf(modal.dialog), modal.options.live ?? [])
              : inertTargets(
                  root,
                  undefined,
                  state.backdrop && state.dialog ? [modal.dialog] : [],
                  state.backdrop && modal.options.backdrop !== undefined
                    ? [modal.options.backdrop]
                    : [],
                );
        for (const element of inerted) {
          if (top() !== modal) {
            refreshAgain = true;
            break;
          }
          if (!targets.has(element)) {
            inerted.delete(element);
            element.removeAttribute("inert");
          }
        }
        if (!refreshAgain) {
          for (const element of targets) {
            if (top() !== modal) {
              refreshAgain = true;
              break;
            }
            if (!element.hasAttribute("inert")) {
              inerted.add(element);
              element.setAttribute("inert", "");
            }
          }
        }
      } while (refreshAgain);
      syncObserver();
    } finally {
      applying = false;
    }
  };
  const focusOpen = (modal: OpenModal) => {
    if (
      modal.strict &&
      (disposed || top() !== modal || !strictState(modal).dialog || !strictState(modal).backdrop)
    ) {
      return;
    }
    const focus = modal.options.focus;
    focusTarget(
      modal.strict &&
        (focus === undefined ||
          !owned(false, focus) ||
          !modal.dialog.contains(focus) ||
          obstructed(focus))
        ? modal.dialog
        : (focus ?? modal.dialog),
    );
  };
  // Performs a key's action in the top card, and returns whether the key is the card's.
  const act = (modal: OpenModal, action: FocusKeyAction, repeat: boolean): boolean => {
    const active = document.activeElement;
    // A held press or close key: its first press acted, and the browser's repeat must not.
    if (repeat && (action === "press" || action === "close")) {
      return true;
    }
    if (action === "press") {
      const control =
        active instanceof
          (modal.strict ? (document.defaultView?.HTMLElement ?? HTMLElement) : HTMLElement) &&
        active !== modal.dialog &&
        within(modal, active);
      if (control) {
        active.click();
      }
      return control;
    }
    if (action === "close") {
      modal.options.close?.();
      return modal.options.close !== undefined;
    }
    const targets = modalTargets(modal);
    const target = stepFocus(
      targets,
      targets.find((element) => element === active),
      action,
    );
    if (target !== undefined) {
      focusTarget(target);
    }
    return true;
  };
  const refuse = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Blur can leave focus on body without a focusin event. Contain known keys from neutral
  // document targets and recover navigation on keydown.
  const onNeutralKey = (event: KeyboardEvent): boolean => {
    const modal = top();
    const { body, documentElement } = document;
    const action = focusKeyAction(event.key, event.shiftKey, false);
    if (
      disposed ||
      modal?.strict !== true ||
      (event.target !== document && event.target !== body && event.target !== documentElement) ||
      action === undefined
    ) {
      return false;
    }
    refuse(event);
    const active = document.activeElement;
    if (
      event.type === "keydown" &&
      (action === "next" || action === "previous") &&
      (active === null || active === body || active === documentElement) &&
      !active?.shadowRoot?.activeElement &&
      event.composedPath()[0] === event.target
    ) {
      const state = strictState(modal);
      if (state.dialog && state.backdrop) {
        act(modal, action, event.repeat);
      }
    }
    return true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const modal = top();
    if (modal?.strict) {
      onNeutralKey(event);
      return;
    }
    const action = focusKeyAction(event.key, event.shiftKey, false);
    if (modal !== undefined && action !== undefined && act(modal, action, event.repeat)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  // A Space press activates a button on its keyup, which keydown's click already did.
  const onKeyUp = (event: KeyboardEvent) => {
    const modal = top();
    if (modal?.strict) {
      onNeutralKey(event);
      return;
    }
    if (event.key === " " && modal !== undefined && within(modal, document.activeElement)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    const modal = top();
    if (modal !== undefined && !within(modal, event.target as Node | null)) {
      focusOpen(modal);
    }
  };
  const keyOwner = new WeakMap<Event, OpenModal>();
  // Refuse outside targets before descendant/delegated handlers, retaining caller handling for
  // admitted events. Earlier root/ancestor capture handlers and world press gates remain caller-owned.
  const onRootInput = (event: Event) => {
    const modal = top();
    if (modal?.strict !== true || disposed) {
      return;
    }
    const state = strictState(modal);
    const node = event.target as Node | null;
    const inside = state.backdrop && state.dialog && modal.dialog.contains(node);
    const keyboard =
      event.type === "keydown" || event.type === "keypress" || event.type === "keyup";
    if (!inside && (keyboard || !state.backdrop || event.target !== modal.options.backdrop)) {
      // A body or html root captures neutral keys before they can bubble to document.
      if (!keyboard || !onNeutralKey(event as KeyboardEvent)) {
        refuse(event);
      }
    } else if (keyboard) {
      keyOwner.set(event, modal);
    }
  };
  const onRootKey = (event: KeyboardEvent) => {
    const modal = top();
    if (modal?.strict !== true || disposed) {
      if (keyOwner.has(event)) {
        refuse(event);
      }
      return;
    }
    const state = strictState(modal);
    if (
      keyOwner.get(event) !== modal ||
      !state.dialog ||
      !state.backdrop ||
      !modal.dialog.contains(event.target as Node | null)
    ) {
      refuse(event);
      return;
    }
    const action = focusKeyAction(event.key, event.shiftKey, false);
    if (action === undefined) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keydown") {
      act(modal, action, event.repeat);
    }
  };
  const inputTypes = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "keydown",
    "keypress",
    "keyup",
  ] as const;
  const keyTypes = ["keydown", "keypress", "keyup"] as const;
  for (const type of inputTypes) {
    root.addEventListener(type, onRootInput, true);
  }
  for (const type of keyTypes) {
    root.addEventListener(type, onRootKey);
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("keypress", onNeutralKey);
  document.addEventListener("focusin", onFocusIn);
  return {
    back() {
      const modal = top();
      modal?.options.close?.();
      return modal !== undefined;
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      observer = undefined;
      observed = undefined;
      for (const type of inputTypes) {
        root.removeEventListener(type, onRootInput, true);
      }
      for (const type of keyTypes) {
        root.removeEventListener(type, onRootKey);
      }
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keypress", onNeutralKey);
      document.removeEventListener("focusin", onFocusIn);
      stack.length = 0;
      applyInert();
    },
    open(options, dialog) {
      const accepted = prepare(options, dialog);
      const modal: OpenModal = {
        dialog,
        opener: document.activeElement,
        options: accepted,
        strict: accepted.isolation === "dialog",
      };
      stack.push(modal);
      dialog.setAttribute("aria-modal", "true");
      if (!dialog.hasAttribute("tabindex")) {
        dialog.tabIndex = -1;
      }
      applyInert();
      focusOpen(modal);
      return () => {
        const index = stack.indexOf(modal);
        if (index < 0) {
          return;
        }
        const wasTop = index === stack.length - 1;
        stack.splice(index, 1);
        dialog.removeAttribute("aria-modal");
        applyInert();
        if (!wasTop) {
          return;
        }
        const below = top();
        const { opener } = modal;
        if (usable(opener) && (below === undefined || within(below, opener))) {
          focusTarget(opener);
          return;
        }
        const fallback = modal.options.restore?.() ?? null;
        if ((modal.strict || below?.strict === true) && (disposed || top() !== below)) {
          return;
        }
        if (usable(fallback)) {
          focusTarget(fallback);
        } else if (below !== undefined) {
          focusOpen(below);
        }
      };
    },
  };
}
