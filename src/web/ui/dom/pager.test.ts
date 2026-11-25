// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGER_GAP, pagerState } from "../../../ui/pager.ts";
import {
  createPager,
  PAGER_CLASS,
  PAGER_COUNT_CLASS,
  PAGER_CURRENT_ATTRIBUTE,
  PAGER_DOT_CLASS,
  type PagerOptions,
} from "./pager.ts";
import { REFUSAL_ATTRIBUTES } from "./refusalCue.ts";

const rule = { holdMs: 500, slopPx: 5 };
const css = readFileSync(join(import.meta.dirname, "pager.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function fixture(extra: Partial<PagerOptions> = {}) {
  let page = 0;
  const step = vi.fn((direction: -1 | 1) => {
    page += direction;
  });
  const pager = createPager(document, {
    countText: (state) => `${state.page + 1} / ${state.pages}`,
    labels: { next: "Next", previous: "Previous" },
    rule,
    state: () => pagerState(page, 3),
    step,
    ...extra,
  });
  document.body.append(pager.element);
  return { pager, step };
}

const pointerClick = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

describe("createPager", () => {
  it("holds Previous, the count and Next in focus order as one action group", () => {
    const { pager } = fixture({ className: "game-pager" });
    expect(pager.element.classList.contains(PAGER_CLASS)).toBe(true);
    expect(pager.element.classList.contains("game-pager")).toBe(true);
    expect([...pager.element.children]).toEqual([
      pager.previous.element,
      pager.count,
      pager.next.element,
    ]);
    expect(pager.count.classList.contains(PAGER_COUNT_CLASS)).toBe(true);
    expect(pager.count.getAttribute("aria-live")).toBe("polite");
    expect(pager.count.textContent).toBe("1 / 3");
    expect(pager.previous.element.textContent).toBe("Previous");
    expect(pager.previous.element.dataset.uiButtonRole).toBe("secondary");
    expect(pager.next.element.querySelector(`[${REFUSAL_ATTRIBUTES.label}]`)).not.toBeNull();
  });

  it("disables an unavailable step and steps through available ones", () => {
    const { pager, step } = fixture();
    expect(pager.previous.element.disabled).toBe(true);
    expect(pager.next.element.disabled).toBe(false);
    pager.next.element.click();
    expect(step).toHaveBeenCalledWith(1);
    pager.refresh();
    expect(pager.count.textContent).toBe("2 / 3");
    expect(pager.previous.element.disabled).toBe(false);
    pager.next.element.click();
    pager.refresh();
    expect(pager.next.element.disabled).toBe(true);
  });

  it("plays the refusal cue on a pointer press of an unavailable step", () => {
    vi.useFakeTimers();
    const { pager, step } = fixture({
      refusal: { cue: { shake: 2, stepMs: 50, steps: 4 }, reducedMotion: () => true },
    });
    const previous = pager.previous.element;
    expect(previous.disabled).toBe(false);
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.tabIndex).toBe(-1);
    pointerClick(previous);
    expect(step).not.toHaveBeenCalled();
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    vi.advanceTimersByTime(200);
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
  });

  it("leaves a playing refusal cue playing on another press, and stops it on request", () => {
    vi.useFakeTimers();
    const { pager } = fixture({
      refusal: { cue: { shake: 2, stepMs: 50, steps: 4 }, reducedMotion: () => true },
    });
    const previous = pager.previous.element;
    pointerClick(previous);
    vi.advanceTimersByTime(150);
    pointerClick(previous);
    vi.advanceTimersByTime(50);
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
    pointerClick(previous);
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    pager.stopRefusal();
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
    pointerClick(previous);
    pager.dispose();
    expect(previous.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
  });

  it("blocks both steps while the caller's guard is closed", () => {
    let open = false;
    const { pager, step } = fixture({ active: () => open });
    pager.next.element.click();
    expect(step).not.toHaveBeenCalled();
    open = true;
    pager.next.element.click();
    expect(step).toHaveBeenCalledOnce();
  });

  it("shows decorative dots and keeps the count text for assistive technology", () => {
    const { pager } = fixture({ dots: true });
    const dots = [...pager.count.querySelectorAll<HTMLElement>(`.${PAGER_DOT_CLASS}`)];
    expect(dots).toHaveLength(3);
    expect(dots.map((dot) => dot.hasAttribute(PAGER_CURRENT_ATTRIBUTE))).toEqual([
      true,
      false,
      false,
    ]);
    expect(dots[0]!.parentElement!.getAttribute("aria-hidden")).toBe("true");
    expect(pager.count.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    expect(pager.count.textContent).toBe("1 / 3");
  });

  it("arranges its parts by the one pager gap through the action group", () => {
    const { pager } = fixture();
    const sizes = {
      count: { height: 20, width: 41 },
      next: { height: 48, width: 70 },
      previous: { height: 48, width: 90 },
    };
    const arrangement = pager.arrange({ sizes, width: 300 });
    expect(arrangement.gap).toEqual(PAGER_GAP);
    const value = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);
    expect(value(pager.previous.element, "--ui-action-x")).toBe("41");
    expect(value(pager.count, "--ui-action-x")).toBe("139");
    expect(value(pager.next.element, "--ui-action-x")).toBe("188");
    expect(value(pager.previous.element, "--ui-action-outset-right")).toBe("4");
  });
});

describe("pager.css", () => {
  it("matches only through zero-specificity selectors, with no literals", () => {
    const selectors = [...css.matchAll(/(^|\n)\s*([^@{}\s][^{}]*)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\(/);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css.replace(/\* -?1px\b/g, "")).not.toMatch(/\d(px|rem|em)\b/);
    const count = /:where\(\.ui-pager-count\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(count).toContain("pointer-events: none");
    expect(css).toContain("@media (forced-colors: active)");
  });
});
