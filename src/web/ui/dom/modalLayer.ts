import { type FocusKeyAction, focusKeyAction, stepFocus } from "../../../ui/focusKeys.ts";

// One modal layer shared by every card a game opens over its UI root. The top modal alone takes
// the keyboard: Tab and the arrows step the focus through its controls, wrapping and trapped in
// it; Enter and Space click the focused control once per press; Escape and P close a closeable
// card (ui/focusKeys). It marks the card aria-modal, makes every other layer of the root inert,
// focuses the card's default action on open and restores the focus on close. It does not use
// <dialog>.showModal() or popover: the top layer renders outside a turned page frame.

export interface ModalOptions {
  // Closes the card on Escape, P or back: the game's own close, which then calls the close
  // returned by open. Undefined for a card the player cannot close.
  readonly close?: () => void;
  // The control focused on open, or undefined for the card itself.
  readonly focus?: HTMLElement;
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
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(", ");

// The controls Tab reaches in dialog, in document order: focusable, not tabindex -1 and not in a
// hidden or inert subtree.
export function focusTargets(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && element.closest("[hidden], [inert]") === null,
  );
}

function usable(element: Element | null): element is HTMLElement {
  return (
    element !== null &&
    element.isConnected &&
    "focus" in element &&
    element.closest("[hidden], [inert]") === null
  );
}

// The modal layer over root, whose element children are the game's UI layers.
export function createModalLayer(root: HTMLElement): ModalLayer {
  const document = root.ownerDocument;
  const stack: OpenModal[] = [];
  const inerted = new Set<Element>();
  const top = () => stack.at(-1);
  const layerOf = (dialog: HTMLElement) =>
    [...root.children].find((child) => child.contains(dialog));
  const applyInert = () => {
    const modal = top();
    const live = modal === undefined ? undefined : layerOf(modal.dialog);
    for (const child of root.children) {
      if (modal !== undefined && child !== live) {
        if (!child.hasAttribute("inert")) {
          child.setAttribute("inert", "");
          inerted.add(child);
        }
      } else if (inerted.delete(child)) {
        child.removeAttribute("inert");
      }
    }
  };
  const focusOpen = (modal: OpenModal) => (modal.options.focus ?? modal.dialog).focus();
  // Performs a key's action in the top card, and returns whether the key is the card's.
  const act = (modal: OpenModal, action: FocusKeyAction, repeat: boolean): boolean => {
    const active = document.activeElement;
    // A held press or close key: its first press acted, and the browser's repeat must not.
    if (repeat && (action === "press" || action === "close")) {
      return true;
    }
    if (action === "press") {
      const control =
        active instanceof HTMLElement && active !== modal.dialog && modal.dialog.contains(active);
      if (control) {
        active.click();
      }
      return control;
    }
    if (action === "close") {
      modal.options.close?.();
      return modal.options.close !== undefined;
    }
    const targets = focusTargets(modal.dialog);
    stepFocus(
      targets,
      targets.find((target) => target === active),
      action,
    )?.focus();
    return true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const modal = top();
    const action = focusKeyAction(event.key, event.shiftKey, false);
    if (modal !== undefined && action !== undefined && act(modal, action, event.repeat)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  // A Space press activates a button on its keyup, which keydown's click already did.
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " " && top()?.dialog.contains(document.activeElement)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    const modal = top();
    if (modal !== undefined && !modal.dialog.contains(event.target as Node | null)) {
      focusOpen(modal);
    }
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("focusin", onFocusIn);
  return {
    back() {
      const modal = top();
      modal?.options.close?.();
      return modal !== undefined;
    },
    dispose() {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("focusin", onFocusIn);
      stack.length = 0;
      applyInert();
    },
    open(options, dialog) {
      const modal: OpenModal = { dialog, opener: document.activeElement, options };
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
        if (usable(opener) && (below === undefined || below.dialog.contains(opener))) {
          opener.focus();
          return;
        }
        const fallback = options.restore?.() ?? null;
        if (usable(fallback)) {
          fallback.focus();
        } else if (below !== undefined) {
          focusOpen(below);
        }
      };
    },
  };
}
