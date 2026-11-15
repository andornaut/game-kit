// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createLoadingAttempts } from "../../../load/loadingAttempts.ts";
import { mountLoadingFailure } from "./loadingFailure.ts";

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
    }
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
