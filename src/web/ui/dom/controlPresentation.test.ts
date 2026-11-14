// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { ControlAvailability } from "../../../ui/controlPresentation.ts";
import {
  bindButtonAvailability,
  createDisclosure,
  createPageDivider,
  setPageDivider,
} from "./controlPresentation.ts";

describe("button availability", () => {
  it("keeps an unmet action focusable with a visible reason, blocking action but allowing refusal feedback", () => {
    const button = document.createElement("button");
    const reason = document.createElement("span");
    document.body.append(button, reason);
    button.textContent = "Apply";
    const action = vi.fn();
    const refusal = vi.fn();
    button.addEventListener("click", action);
    let state: ControlAvailability = { kind: "unavailable", reason: "Requires another item" };
    const binding = bindButtonAvailability(
      { getAvailability: () => state, onUnavailable: refusal, reason },
      button,
    );
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-description")).toBe(reason.textContent);
    expect(reason.textContent).toBe("Requires another item");
    expect(reason.hidden).toBe(false);
    expect(button.textContent).toBe("Apply");
    expect(action).not.toHaveBeenCalled();
    expect(refusal).toHaveBeenCalledExactlyOnceWith("Requires another item");

    state = { kind: "available" };
    button.click();
    expect(action).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(button.hasAttribute("aria-description")).toBe(false);
    expect(reason.hidden).toBe(true);
    binding.dispose();
    button.remove();
    reason.remove();
  });

  it("omits irrelevant controls and rejects an invalid state atomically", () => {
    const button = document.createElement("button");
    const reason = document.createElement("span");
    let state: ControlAvailability = { kind: "omitted" };
    const binding = bindButtonAvailability({ getAvailability: () => state, reason }, button);
    expect(button.hidden).toBe(true);
    const before = button.outerHTML;
    state = { kind: "unavailable", reason: "" };
    expect(() => binding.refresh()).toThrow();
    expect(button.outerHTML).toBe(before);
    binding.dispose();
  });

  it("rechecks changed requirements at click time and releases its listener on disposal", () => {
    const button = document.createElement("button");
    const reason = document.createElement("span");
    let state: ControlAvailability = { kind: "available" };
    const action = vi.fn();
    const binding = bindButtonAvailability({ getAvailability: () => state, reason }, button);
    button.addEventListener("click", action);
    state = { kind: "unavailable", reason: "Requirement changed" };
    button.click();
    expect(action).not.toHaveBeenCalled();
    expect(reason.textContent).toBe("Requirement changed");
    binding.dispose();
    button.click();
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("shared content chrome", () => {
  it("sets a single inherited divider token pair without changing content", () => {
    const root = document.createElement("section");
    root.textContent = "Content";
    const first = createPageDivider(document);
    const second = createPageDivider(document);
    root.append(first, second);
    setPageDivider({ colour: 0x123, thickness: 1.5 }, root);
    expect(root.style.getPropertyValue("--ui-page-divider-colour")).toBe("#000123");
    expect(root.style.getPropertyValue("--ui-page-divider-thickness")).toBe("1.5");
    expect(root.textContent).toBe("Content");
    expect(first.tagName).toBe("HR");
    expect(first.className).toBe(second.className);
    expect(first.getAttribute("style")).toBeNull();
    expect(second.getAttribute("style")).toBeNull();
    const before = root.outerHTML;
    expect(() => setPageDivider({ colour: 0x1000000, thickness: 2 }, root)).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it("creates a decorative right chevron while the native parent retains navigation semantics", () => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Details";
    const icon = createDisclosure(document, {
      colour: 0x123456,
      height: 14,
      strokeWidth: 2,
      width: 8,
    });
    button.append(icon);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect(icon.getAttribute("viewBox")).toBe("0 0 8 14");
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M1 1 L7 7 L1 13");
    expect(button.textContent).toBe("Details");
    expect(icon.style.getPropertyValue("--ui-disclosure-width")).toBe("8");
  });
});
