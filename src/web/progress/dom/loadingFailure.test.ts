// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createLoadingAttempts, createRequiredLoading } from "../../../load/loadingAttempts.ts";
import { type LoadingFailureLayout, mountLoadingFailure } from "./loadingFailure.ts";

describe("mountLoadingFailure", () => {
  it("contains Retry activation keys without preventing defaults or synthesizing clicks", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onRetry = vi.fn();
    const view = mountLoadingFailure({ onRetry }, parent);
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    const button = view.element.querySelector("button")!;
    const bubble = vi.fn();
    const capture = vi.fn();
    const types = ["keydown", "keypress", "keyup"] as const;
    for (const type of types) {
      window.addEventListener(type, bubble);
      window.addEventListener(type, capture, true);
    }
    try {
      for (const key of ["Enter", " ", "Spacebar"]) {
        for (const type of ["keydown", "keydown", "keypress", "keyup"]) {
          const event = new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            key,
            repeat: type === "keydown",
          });
          expect(button.dispatchEvent(event)).toBe(true);
          expect(event.defaultPrevented).toBe(false);
        }
      }
      expect(bubble).not.toHaveBeenCalled();
      expect(capture).toHaveBeenCalledTimes(12);
      expect(onRetry).not.toHaveBeenCalled();
      button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
      button.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Escape" }));
      expect(bubble).toHaveBeenCalledTimes(2);
      view.dispose();
      parent.append(button);
      button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      expect(bubble).toHaveBeenCalledTimes(3);
      button.click();
      expect(onRetry).not.toHaveBeenCalled();
    } finally {
      view.dispose();
      parent.remove();
      for (const type of types) {
        window.removeEventListener(type, bubble);
        window.removeEventListener(type, capture, true);
      }
    }
  });

  it("contains a held Retry key after disable and blur without trapping other controls or disposal", async () => {
    const exercise = async (key: string) => {
      const parent = document.createElement("div");
      const other = document.createElement("button");
      document.body.append(parent, other);
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onRetry = vi.fn(() => pending);
      const view = mountLoadingFailure({ onRetry }, parent);
      view.update({ attempt: 1, error: undefined, kind: "failed" });
      const button = view.element.querySelector("button")!;
      const bubble = vi.fn();
      const types = ["keydown", "keypress", "keyup"] as const;
      const send = (target: EventTarget, type: string, eventKey = key, repeat = false) => {
        const event = new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key: eventKey,
          repeat,
        });
        expect(target.dispatchEvent(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      };
      for (const type of types) {
        window.addEventListener(type, bubble);
      }
      try {
        button.focus();
        send(button, "keydown");
        button.click();
        expect(button.disabled).toBe(true);
        button.blur();
        send(document.body, "keydown", key, true);
        send(document.body, "keypress");
        send(document.body, "keyup");
        send(button, "keydown");
        button.click();
        send(button, "keyup");
        expect(onRetry).toHaveBeenCalledOnce();
        expect(bubble).not.toHaveBeenCalled();
        finish();
        await pending;
        await Promise.resolve();
        expect(button.disabled).toBe(false);

        send(button, "keydown");
        other.focus();
        send(other, "keypress");
        send(other, "keyup");
        other.blur();
        send(document.body, "keyup");
        send(document.body, "keydown", "ArrowDown");
        expect(bubble).toHaveBeenCalledTimes(4);
        button.focus();
        send(button, "keydown");
        window.dispatchEvent(new Event("blur"));
        button.blur();
        send(document.body, "keyup");
        expect(bubble).toHaveBeenCalledTimes(5);

        button.focus();
        send(button, "keydown");
        view.dispose();
        send(document.body, "keyup");
        expect(bubble).toHaveBeenCalledTimes(6);
        expect(onRetry).toHaveBeenCalledOnce();
      } finally {
        finish();
        view.dispose();
        parent.remove();
        other.remove();
        for (const type of types) {
          window.removeEventListener(type, bubble);
        }
      }
    };
    await exercise("Enter");
    await exercise(" ");
  });

  it("shows the exact shared text in native fallback styles without a font, image or second bar", () => {
    const parent = document.createElement("div");
    parent.style.font = "0px MissingGameFont";
    parent.style.color = "transparent";
    const bar = document.createElement("div");
    bar.setAttribute("role", "progressbar");
    parent.append(bar);
    const onRetry = vi.fn();
    const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    const view = mountLoadingFailure({ onRetry }, parent);
    expect(view.element.hidden).toBe(true);
    view.update({ attempt: 1, error: new Error("Font failed"), kind: "failed" });
    expect(view.element.hidden).toBe(false);
    expect(view.element.getAttribute("role")).toBe("alert");
    expect(view.element.querySelector("h2")?.textContent).toBe("Loading failed");
    expect(view.element.querySelector("p")?.textContent).toBe(
      "Some game files could not load. Try again.",
    );
    expect(view.element.querySelector("button")?.textContent).toBe("Retry");
    for (const node of [
      view.element,
      ...view.element.querySelectorAll<HTMLElement>("h2, p, button"),
    ]) {
      expect(node.style.getPropertyValue("font")).toBe("medium sans-serif");
      expect(node.style.getPropertyPriority("font")).toBe("important");
      expect(node.style.getPropertyValue("all")).toBe("revert");
      expect(node.style.getPropertyPriority("all")).toBe("important");
    }
    expect(view.element.style.display).toBe("block");
    expect(view.element.style.gap).toBe("");
    expect(view.element.style.padding).toBe("");
    expect(view.element.querySelector("button")!.style.minWidth).toBe("");
    expect(view.element.querySelector("button")!.style.minHeight).toBe("");
    expect(view.element.querySelector("button")!.style.alignSelf).toBe("");
    // The DOM emulator does not serialize CSS system colours; verify the actual CSSOM writes.
    expect(
      writes.mock.calls.filter(
        ([name, value, priority]) =>
          name === "color" && value === "CanvasText" && priority === "important",
      ),
    ).toHaveLength(4);
    expect(
      writes.mock.calls.filter(
        ([name, value, priority]) =>
          name === "background-color" && value === "Canvas" && priority === "important",
      ),
    ).toHaveLength(4);
    expect(parent.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(parent.firstChild).toBe(bar);
    expect(parent.querySelector("img, canvas, link, style")).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    view.dispose();
    writes.mockRestore();
  });

  it("uses caller spacing, target minimums and alignment after the hardened reset across states", () => {
    for (const [actionAlign, expected] of [
      ["start", "flex-start"],
      ["center", "center"],
      ["end", "flex-end"],
    ] as const) {
      const parent = document.createElement("div");
      parent.style.font = "0px MissingGameFont";
      const layout = { actionAlign, gapPx: 8.5, minActionSizePx: 48, paddingPx: 12 };
      const view = mountLoadingFailure({ layout, onRetry: vi.fn() }, parent);
      const retry = view.element.querySelector("button")!;
      const expectedRoot = {
        "box-sizing": "border-box",
        "flex-direction": "column",
        gap: "8.5px",
        padding: "12px",
      };
      const expectedAction = {
        "align-items": "center",
        "align-self": expected,
        "box-sizing": "border-box",
        display: "flex",
        "flex-shrink": "0",
        "justify-content": "center",
        "min-height": "48px",
        "min-width": "48px",
        "text-align": "center",
      };
      layout.gapPx = 100;
      layout.minActionSizePx = 1;
      for (const state of [
        { attempt: 1, error: undefined, kind: "failed" },
        { attempt: 2, kind: "loading" },
        { attempt: 2, error: undefined, kind: "failed" },
        { attempt: 2, kind: "ready" },
      ] as const) {
        view.update(state);
        expect(view.element.style.display).toBe(state.kind === "failed" ? "flex" : "none");
        expect(view.element.style.getPropertyPriority("display")).toBe("important");
        for (const [property, value] of Object.entries(expectedRoot)) {
          expect(view.element.style.getPropertyValue(property)).toBe(value);
          expect(view.element.style.getPropertyPriority(property)).toBe("important");
        }
        for (const [property, value] of Object.entries(expectedAction)) {
          expect(retry.style.getPropertyValue(property)).toBe(value);
          expect(retry.style.getPropertyPriority(property)).toBe("important");
        }
        for (const node of view.element.querySelectorAll<HTMLElement>("h2, p, button")) {
          expect(node.style.margin).toBe("0px");
          expect(node.style.getPropertyPriority("margin")).toBe("important");
          expect(node.style.font).toBe("medium sans-serif");
          expect(node.style.getPropertyPriority("font")).toBe("important");
          expect(node.style.getPropertyValue("all")).toBe("revert");
        }
      }
      expect(retry.style.width).toBe("");
      expect(retry.style.height).toBe("");
      view.dispose();
    }
  });

  it("guards real click dispatch with caller layout while preserving single-flight retry and disposal", async () => {
    let finish!: () => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mountLoadingFailure(
      {
        layout: { actionAlign: "end", gapPx: 0, minActionSizePx: 0, paddingPx: 0 },
        onRetry,
      },
      document.createElement("div"),
    );
    const retry = view.element.querySelector("button")!;
    const click = () => retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click();
    expect(onRetry).not.toHaveBeenCalled();
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    click();
    click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry.disabled).toBe(true);
    expect(view.element.style.display).toBe("flex");
    expect(retry.style.minWidth).toBe("0px");
    expect(retry.style.minHeight).toBe("0px");
    view.update({ attempt: 2, kind: "loading" });
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(view.element.hidden).toBe(true);
    view.update({ attempt: 2, kind: "ready" });
    expect(view.element.hidden).toBe(true);
    view.update({ attempt: 2, error: undefined, kind: "failed" });
    expect(view.element.hidden).toBe(false);
    expect(retry.disabled).toBe(true);
    click();
    expect(onRetry).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    expect(view.element.hidden).toBe(false);
    expect(retry.disabled).toBe(false);
    view.dispose();
    click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("rejects incomplete, nonfinite, negative or unknown layout values before any DOM write", () => {
    const parent = document.createElement("div");
    const existing = document.createElement("span");
    existing.textContent = "Existing caller content";
    parent.append(existing);
    const before = parent.innerHTML;
    const onRetry = vi.fn();
    const valid = { actionAlign: "end", gapPx: 8, minActionSizePx: 48, paddingPx: 12 };
    const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    try {
      for (const property of ["gapPx", "minActionSizePx", "paddingPx"]) {
        for (const value of [-1, NaN, Infinity, -Infinity, "48", null, undefined]) {
          expect(() =>
            mountLoadingFailure(
              {
                layout: { ...valid, [property]: value } as unknown as LoadingFailureLayout,
                onRetry,
              },
              parent,
            ),
          ).toThrow(RangeError);
          expect(parent.innerHTML).toBe(before);
        }
      }
      for (const actionAlign of ["left", "END", undefined]) {
        expect(() =>
          mountLoadingFailure(
            { layout: { ...valid, actionAlign } as unknown as LoadingFailureLayout, onRetry },
            parent,
          ),
        ).toThrow(RangeError);
      }
      expect(() =>
        mountLoadingFailure({ layout: null as unknown as LoadingFailureLayout, onRetry }, parent),
      ).toThrow(RangeError);
      expect(writes).not.toHaveBeenCalled();
      expect(onRetry).not.toHaveBeenCalled();
      expect([...parent.children]).toEqual([existing]);
    } finally {
      writes.mockRestore();
    }
  });

  it("keeps Retry disabled through synchronous failed registry notifications until its flight settles", async () => {
    await Promise.all(
      [
        undefined,
        { actionAlign: "end", gapPx: 8, minActionSizePx: 48, paddingPx: 12 } as const,
      ].flatMap((layout) =>
        [false, true].map(async (reject) => {
          let resolve!: () => void;
          let fail!: (error: unknown) => void;
          const pending = new Promise<void>((yes, no) => {
            resolve = yes;
            fail = no;
          });
          const resource = { retry: vi.fn(() => pending), status: () => "failed" as const };
          const required = createRequiredLoading([resource]);
          let current: Promise<void> | undefined;
          const onRetry = vi.fn(() => (current = required.retry()));
          const view = mountLoadingFailure(
            { ...(layout === undefined ? {} : { layout }), onRetry },
            document.createElement("div"),
          );
          const unsubscribe = required.subscribe(view.update);
          const button = view.element.querySelector("button")!;
          const click = () => button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          try {
            expect(required.state).toMatchObject({ attempt: 1, kind: "failed" });
            click();
            expect(required.state).toMatchObject({ attempt: 2, kind: "failed" });
            expect(view.element.hidden).toBe(false);
            expect(button.disabled).toBe(true);
            for (let repeat = 0; repeat < 3; repeat += 1) {
              view.update(required.state);
              click();
              expect(button.disabled).toBe(true);
            }
            expect(onRetry).toHaveBeenCalledOnce();
            expect(resource.retry).toHaveBeenCalledOnce();
            if (reject) {
              fail(new Error("Required resource retry failed"));
            } else {
              resolve();
            }
            await current;
            await Promise.resolve();
            expect(required.state.kind).toBe("failed");
            expect(view.element.hidden).toBe(false);
            expect(button.disabled).toBe(false);
            click();
            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(resource.retry).toHaveBeenCalledTimes(2);
            view.dispose();
            const detached = view.element.outerHTML;
            await current;
            await Promise.resolve();
            click();
            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(view.element.outerHTML).toBe(detached);
          } finally {
            unsubscribe();
            view.dispose();
            required.dispose();
            resolve();
          }
        }),
      ),
    );
  });

  it("retries one required load at a time, repeats the same error and continues once on success", async () => {
    const parent = document.createElement("div");
    const load = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Font failed"))
      .mockRejectedValueOnce(new Error("UI image failed"))
      .mockResolvedValue();
    const onReady = vi.fn();
    let current: Promise<void> | undefined;
    const view = mountLoadingFailure({ onRetry: () => (current = attempts.retry()) }, parent);
    const attempts = createLoadingAttempts({ load, onReady, onState: view.update });
    await attempts.start();
    const text = view.element.textContent;
    const button = view.element.querySelector("button")!;
    button.click();
    button.click();
    expect(button.disabled).toBe(true);
    await current;
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.element.hidden).toBe(false);
    expect(view.element.textContent).toBe(text);
    expect(onReady).not.toHaveBeenCalled();
    button.click();
    button.click();
    await current;
    expect(view.element.hidden).toBe(true);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onReady).toHaveBeenCalledTimes(1);
    view.dispose();
    attempts.dispose();
  });

  it("restores explicit Retry after its callback throws or rejects without exposing error details", async () => {
    const onRetry = vi
      .fn<() => void | Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("Private loader details");
      })
      .mockRejectedValueOnce(new Error("More private loader details"));
    const view = mountLoadingFailure({ onRetry }, document.createElement("div"));
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    const button = view.element.querySelector("button")!;
    button.click();
    expect(button.disabled).toBe(false);
    button.click();
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    expect(button.disabled).toBe(true);
    await Promise.resolve();
    expect(button.disabled).toBe(false);
    expect(view.element.textContent).toBe(
      "Loading failedSome game files could not load. Try again.Retry",
    );
    view.dispose();
  });

  it("ignores older attempt notifications and removes retry callbacks on disposal", async () => {
    let resolve!: () => void;
    const work = new Promise<void>((yes) => {
      resolve = yes;
    });
    const onRetry = vi.fn(() => work);
    const parent = document.createElement("div");
    const view = mountLoadingFailure({ onRetry }, parent);
    const button = view.element.querySelector("button")!;
    view.update({ attempt: 2, kind: "loading" });
    view.update({ attempt: 1, error: undefined, kind: "failed" });
    expect(view.element.hidden).toBe(true);
    view.update({ attempt: 2, error: undefined, kind: "failed" });
    button.click();
    view.dispose();
    view.dispose();
    const detached = view.element.outerHTML;
    resolve();
    await work;
    await Promise.resolve();
    button.click();
    view.update({ attempt: 3, error: undefined, kind: "failed" });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(view.element.outerHTML).toBe(detached);
  });
});
