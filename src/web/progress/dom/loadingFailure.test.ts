// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createLoadingAttempts } from "../../../load/loadingAttempts.ts";
import { type LoadingFailureLayout, mountLoadingFailure } from "./loadingFailure.ts";

describe("mountLoadingFailure", () => {
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
    finish();
    await Promise.resolve();
    expect(view.element.hidden).toBe(true);
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
