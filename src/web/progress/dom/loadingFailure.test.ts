// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createLoadingAttempts, createRequiredLoading } from "../../../load/loadingAttempts.ts";
import {
  type LoadingFailureLayout,
  type LoadingFailurePresentation,
  mountLoadingFailure,
} from "./loadingFailure.ts";

function presentationFixture(unit = 1): LoadingFailurePresentation {
  return {
    action: {
      borderWidthPx: Math.max(1, unit),
      heightPx: 48 * unit,
      highlightHeightPx: Math.max(1, unit),
      paddingBottomPx: 4 * unit,
      paddingXPx: 12,
      shadeHeightPx: 4 * unit,
      widthPx: 128 * unit,
    },
    palette: {
      action: "#63c74d",
      actionText: "#181425",
      border: "#181425",
      highlight: "#fee761",
      lip: "#e4a672",
      panel: "#ead4aa",
      shade: "#265c42",
      shadow: "#181425",
      text: "#3e2731",
    },
    panel: {
      bodyActionGapPx: 24,
      borderWidthPx: 1,
      lipHeightPx: 4,
      maxWidthPx: 328,
      paddingBottomPx: 16,
      paddingTopPx: 24,
      paddingXPx: 16,
      safeInsetPx: 16,
      shadowOffsetPx: 4,
      titleBodyGapPx: 16,
    },
    text: {
      action: { lineHeight: 1.2, sizePx: 18, weight: 700 },
      body: { lineHeight: 1.45, sizePx: 18, weight: 400 },
      title: { lineHeight: 1.2, sizePx: 24, weight: 700 },
    },
  };
}

describe("mountLoadingFailure", () => {
  it("applies and resets only the action synthesis policy without replacing a busy view", async () => {
    const parent = document.createElement("div");
    parent.style.setProperty("font-synthesis", "none");
    document.body.append(parent);
    const presentation = presentationFixture();
    const action = { ...presentation.text.action, synthesis: "weight" as const };
    const configured = { ...presentation, text: { ...presentation.text, action } };
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onRetry = vi.fn(() => work);
    const view = mountLoadingFailure({ onRetry, presentation: configured }, parent);
    const button = view.element.querySelector("button")!;
    const siblings = [...view.element.querySelectorAll<HTMLElement>("h2, p")];
    const siblingStyles = siblings.map((node) => node.style.cssText);
    try {
      expect(button.style.getPropertyValue("font-synthesis")).toBe("weight");
      expect(button.style.getPropertyPriority("font-synthesis")).toBe("important");
      (action as { synthesis: string }).synthesis = "none";
      view.update({ attempt: 1, error: undefined, kind: "failed" });
      expect(button.style.getPropertyValue("font-synthesis")).toBe("weight");
      button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      button.click();
      expect(button.disabled).toBe(true);
      const element = view.element;
      const next = {
        ...presentation,
        text: { ...presentation.text, action: { ...action, synthesis: "none" as const } },
      };
      view.setPresentation(next);
      expect(view.element).toBe(element);
      expect(element.querySelector("button")).toBe(button);
      expect(button.disabled).toBe(true);
      expect(button.style.getPropertyValue("font-synthesis")).toBe("none");
      expect(button.style.getPropertyPriority("font-synthesis")).toBe("important");
      const beforeInvalid = element.outerHTML;
      for (const synthesis of ["auto", "style", "invalid", null, 1]) {
        const invalid = {
          ...presentation,
          text: { ...presentation.text, action: { ...presentation.text.action, synthesis } },
        };
        expect(() =>
          view.setPresentation(invalid as unknown as LoadingFailurePresentation),
        ).toThrow(RangeError);
        expect(element.outerHTML).toBe(beforeInvalid);
      }
      view.setPresentation(presentation);
      expect(button.style.getPropertyValue("font-synthesis")).toBe("");
      expect(button.style.getPropertyPriority("font-synthesis")).toBe("");
      expect(button.disabled).toBe(true);
      expect(siblings.map((node) => node.style.cssText)).toEqual(siblingStyles);
      expect(parent.style.getPropertyValue("font-synthesis")).toBe("none");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onRetry).toHaveBeenCalledOnce();
      finish();
      await work;
      await Promise.resolve();
      expect(button.disabled).toBe(false);
    } finally {
      finish();
      view.dispose();
      parent.remove();
    }
  });

  it("hardens a caller presentation after reset and snapshots its geometry, type and palette", async () => {
    const presentation = presentationFixture(0.5);
    const mutable = presentation as {
      panel: { maxWidthPx: number };
      action: { heightPx: number };
      text: { title: { sizePx: number } };
      palette: { panel: string };
    };
    const onRetry = vi.fn(() => pending);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const parent = document.createElement("div");
    parent.style.fontSize = "0px";
    document.body.append(parent);
    const view = mountLoadingFailure({ onRetry, presentation }, parent);
    const [title, body, button] = [...view.element.children] as [
      HTMLElement,
      HTMLElement,
      HTMLButtonElement,
    ];
    const bubble = vi.fn();
    window.addEventListener("keydown", bubble);
    window.addEventListener("keyup", bubble);
    try {
      mutable.panel.maxWidthPx = 500;
      mutable.action.heightPx = 200;
      mutable.text.title.sizePx = 40;
      mutable.palette.panel = "#ffffff";
      view.update({ attempt: 1, error: undefined, kind: "failed" });
      expect(view.element.style.display).toBe("flex");
      expect(view.element.style.width).toBe("calc(100% - 32px)");
      expect(view.element.style.maxWidth).toBe("328px");
      expect(view.element.style.maxHeight).toBe("calc(100% - 32px)");
      expect(view.element.style.overflow).toBe("auto");
      expect(view.element.style.padding).toBe("24px 16px 16px");
      expect(view.element.style.backgroundColor).toBe("#ead4aa");
      for (const node of [title, body]) {
        expect(node.style.getPropertyValue("background-color")).toBe("transparent");
        expect(node.style.getPropertyPriority("background-color")).toBe("important");
      }
      expect(button.style.backgroundColor).toBe("#63c74d");
      expect(body.style.margin).toBe("16px 0px 24px");
      expect(title.style.fontSize).toBe("24px");
      expect(body.style.fontSize).toBe("18px");
      expect(button.style.fontSize).toBe("18px");
      expect(button.style.width).toBe("64px");
      expect(button.style.height).toBe("24px");
      expect(Number.parseFloat(button.style.minHeight)).toBe(0);
      expect(button.style.padding).toBe("0px 12px 2px");
      expect(button.style.boxShadow).toContain("-2px");
      expect(button.style.justifyContent).toBe("center");
      expect(button.style.alignItems).toBe("center");
      for (const node of [view.element, title, body, button]) {
        expect(node.style.getPropertyValue("all")).toBe("revert");
        for (const property of Array.from({ length: node.style.length }, (_, index) =>
          node.style.item(index),
        )) {
          expect(node.style.getPropertyPriority(property)).toBe("important");
        }
      }
      for (const node of [title, body, button]) {
        expect(node.style.fontFamily).toBe("system-ui, sans-serif");
      }
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
      expect(button.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
      expect(bubble).not.toHaveBeenCalled();
      button.click();
      view.update({ attempt: 2, error: undefined, kind: "failed" });
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onRetry).toHaveBeenCalledOnce();
      expect(button.disabled).toBe(true);
      const replacement = presentationFixture(1);
      const mutableReplacement = replacement as {
        panel: { maxWidthPx: number };
        action: { heightPx: number };
      };
      mutableReplacement.panel.maxWidthPx = 456;
      const element = view.element;
      view.setPresentation(replacement);
      for (const node of [title, body]) {
        expect(node.style.getPropertyValue("background-color")).toBe("transparent");
        expect(node.style.getPropertyPriority("background-color")).toBe("important");
      }
      expect(element.style.backgroundColor).toBe("#ead4aa");
      expect(button.style.backgroundColor).toBe("#63c74d");
      mutableReplacement.action.heightPx = 500;
      expect(view.element).toBe(element);
      expect(element.querySelector("button")).toBe(button);
      expect(element.hidden).toBe(false);
      expect(button.disabled).toBe(true);
      expect(button.style.width).toBe("128px");
      expect(button.style.height).toBe("48px");
      expect(title.style.fontSize).toBe("24px");
      expect(element.style.maxWidth).toBe("456px");
      const beforeInvalid = element.outerHTML;
      const invalid = presentationFixture();
      (invalid as { action: { heightPx: number } }).action.heightPx = NaN;
      expect(() => view.setPresentation(invalid)).toThrow(RangeError);
      expect(element.outerHTML).toBe(beforeInvalid);
      button.blur();
      document.body.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      expect(bubble).not.toHaveBeenCalled();
      finish();
      await pending;
      await Promise.resolve();
      expect(button.disabled).toBe(false);
      view.update({ attempt: 3, kind: "ready" });
      expect(view.element.hidden).toBe(true);
      expect(view.element.style.display).toBe("none");
      expect(parent.querySelector("img, canvas, style, link")).toBeNull();
      view.dispose();
      const detached = element.outerHTML;
      view.setPresentation(invalid);
      expect(element.outerHTML).toBe(detached);
    } finally {
      finish();
      window.removeEventListener("keydown", bubble);
      window.removeEventListener("keyup", bubble);
      view.dispose();
      parent.remove();
    }
  });

  it("rejects invalid or conflicting presentation before creating or styling DOM", () => {
    const invalid: unknown[] = [null, {}, { ...presentationFixture(), text: undefined }];
    for (const path of ["panel", "action", "text.title", "text.body", "text.action"]) {
      const original = presentationFixture();
      const group = path
        .split(".")
        .reduce(
          (object, key) => object[key] as Record<string, unknown>,
          original as unknown as Record<string, unknown>,
        );
      for (const field of Object.keys(group)) {
        for (const value of [-1, NaN, Infinity, -Infinity, "12", undefined]) {
          const copy = structuredClone(original) as unknown as Record<string, unknown>;
          const target = path
            .split(".")
            .reduce((object, key) => object[key] as Record<string, unknown>, copy);
          target[field] = value;
          invalid.push(copy);
        }
      }
    }
    for (const value of ["red", "var(--colour)", "url(image.png)", "#xyz", null, undefined]) {
      invalid.push({
        ...presentationFixture(),
        palette: { ...presentationFixture().palette, panel: value },
      });
    }
    for (const synthesis of ["auto", "style", "invalid", null, 1]) {
      const original = presentationFixture();
      invalid.push({
        ...original,
        text: { ...original.text, action: { ...original.text.action, synthesis } },
      });
    }
    for (const path of ["title", "body", "action"] as const) {
      for (const patch of [{ sizePx: 0 }, { lineHeight: 0 }, { weight: 0 }, { weight: 1001 }]) {
        const original = presentationFixture();
        invalid.push({
          ...original,
          text: { ...original.text, [path]: { ...original.text[path], ...patch } },
        });
      }
    }
    invalid.push({
      ...presentationFixture(),
      panel: { ...presentationFixture().panel, maxWidthPx: 0 },
    });
    invalid.push({
      ...presentationFixture(),
      action: { ...presentationFixture().action, widthPx: 0 },
    });
    invalid.push({
      ...presentationFixture(),
      action: { ...presentationFixture().action, heightPx: 0 },
    });
    invalid.push({
      ...presentationFixture(),
      panel: { ...presentationFixture().panel, safeInsetPx: Number.MAX_VALUE },
    });
    invalid.push({
      ...presentationFixture(),
      panel: { ...presentationFixture().panel, maxWidthPx: 10 },
    });
    invalid.push({
      ...presentationFixture(),
      action: { ...presentationFixture().action, heightPx: 1 },
    });
    invalid.push({
      ...presentationFixture(),
      action: { ...presentationFixture().action, widthPx: 1 },
    });
    const parent = document.createElement("div");
    parent.textContent = "Existing caller content";
    const create = vi.spyOn(document, "createElement");
    const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    try {
      for (const presentation of invalid) {
        expect(() =>
          mountLoadingFailure(
            { onRetry: vi.fn(), presentation: presentation as LoadingFailurePresentation },
            parent,
          ),
        ).toThrow(RangeError);
      }
      expect(() =>
        mountLoadingFailure(
          {
            layout: { actionAlign: "center", gapPx: 0, minActionSizePx: 0, paddingPx: 0 },
            onRetry: vi.fn(),
            presentation: presentationFixture(),
          },
          parent,
        ),
      ).toThrow("mutually exclusive");
      expect(create).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(parent.textContent).toBe("Existing caller content");
    } finally {
      create.mockRestore();
      writes.mockRestore();
    }
  });

  it("contains Retry activation keys without preventing defaults or synthesizing clicks", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onRetry = vi.fn();
    const view = mountLoadingFailure({ onRetry }, parent);
    expect(Object.keys(view).sort()).toEqual(["dispose", "element", "update"]);
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
