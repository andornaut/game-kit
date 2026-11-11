import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProgressState } from "../../../progressState.ts";
import {
  createDomProgressBar,
  PROGRESS_BAR_BAND_CLASS,
  PROGRESS_BAR_CLASS,
  PROGRESS_BAR_PROPERTIES,
} from "./progressBar.ts";

class Style {
  [property: string]: unknown;
  readonly custom = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.custom.set(name, value);
  }
}

class Element {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  className = "";
  readonly dataset: Record<string, string> = {};
  hidden = false;
  readonly ownerDocument = { createElement: () => new Element() };
  readonly style = new Style();
  removed = false;
  append(child: Element): void {
    this.children.push(child);
  }
  remove(): void {
    this.removed = true;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const style = { border: 1, fills: [0xffff00, 0xffaa00], frame: 0, track: 0x333333 };
const frame = { height: 4, width: 102, x: 10, y: 20 };
const mount = (timing?: Parameters<typeof createDomProgressBar>[3]) => {
  const parent = new Element();
  const bar = createDomProgressBar(parent as unknown as HTMLElement, style, frame, timing);
  const element = parent.children[0]!;
  const band = element.children[1]!;
  return { band, bar, element };
};

describe("createDomProgressBar", () => {
  it("mounts pending with every band spanning the track for the stylesheet to animate", () => {
    const { band, element } = mount();
    expect(element.className).toBe(PROGRESS_BAR_CLASS);
    expect(element.attributes.get("role")).toBe("progressbar");
    expect(element.dataset.state).toBe("pending");
    expect(element.hidden).toBe(false);
    expect(element.attributes.has("aria-valuenow")).toBe(false);
    expect(element.children.slice(1).map(({ className }) => className)).toEqual([
      PROGRESS_BAR_BAND_CLASS,
      PROGRESS_BAR_BAND_CLASS,
    ]);
    expect(band.style).toMatchObject({ left: "1px", overflow: "hidden", width: "100px" });
    expect(band.children[0]?.style).toMatchObject({ backgroundColor: "#ffff00", height: "100%" });
    expect(band.children[0]?.style.width).toBeUndefined();
    expect(element.style.custom.size).toBe(0);
  });

  it("renders the shared measured geometry and returns to pending on update", () => {
    const { band, bar, element } = mount();
    bar.update(0.339);
    expect(element.dataset.state).toBe("determinate");
    expect(element.attributes.get("aria-valuenow")).toBe("0.339");
    expect(band.style).toMatchObject({ height: "1px", left: "1px", top: "1px", width: "33px" });
    bar.update(undefined);
    expect(element.dataset.state).toBe("pending");
    expect(element.attributes.has("aria-valuenow")).toBe(false);
    bar.remove();
    expect(element.removed).toBe(true);
  });

  it("writes the caller's timing as custom properties", () => {
    const { element } = mount({ cycleMs: 1200, fullMs: 300, segment: 0.3 });
    expect([...element.style.custom]).toEqual([
      [PROGRESS_BAR_PROPERTIES.cycle, "1200ms"],
      [PROGRESS_BAR_PROPERTIES.full, "300ms"],
      [PROGRESS_BAR_PROPERTIES.segment, "0.3"],
    ]);
  });

  it.each([
    { cycleMs: 0, fullMs: 0, segment: 0.25 },
    { cycleMs: 1000, fullMs: 0, segment: 2 },
    { cycleMs: 1000, fullMs: -1, segment: 0.25 },
  ])("rejects timing %o", (timing) => {
    expect(() => mount(timing)).toThrow(RangeError);
  });

  it("follows a progress state: hidden while idle, full on a measured finish", () => {
    const { band, bar, element } = mount();
    const state = createProgressState();
    state.subscribe(bar.report);
    expect(element.hidden).toBe(true);
    expect(element.dataset.state).toBe("idle");
    const handle = state.begin();
    expect(element.hidden).toBe(false);
    expect(element.dataset.state).toBe("pending");
    handle.progress(0.4);
    handle.finish();
    expect(element.dataset.state).toBe("complete");
    expect(element.hidden).toBe(false);
    expect(element.attributes.get("aria-valuenow")).toBe("1");
    expect(band.style.width).toBe("100px");
    bar.report({ active: false, value: undefined });
    expect(element.dataset.state).toBe("complete");
  });

  it("hides at once when unknown work finishes", () => {
    const { bar, element } = mount();
    const state = createProgressState();
    const handle = state.begin();
    state.subscribe(bar.report);
    handle.finish();
    expect(element.hidden).toBe(true);
    expect(element.dataset.state).toBe("idle");
  });
});

// progressBar.css reads the names the adapter writes, and animates without script.
describe("progressBar.css", () => {
  const css = readFileSync(join(import.meta.dirname, "progressBar.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

  it.each(Object.values(PROGRESS_BAR_PROPERTIES))("reads %s", (name) => {
    expect(css).toContain(`var(${name},`);
  });

  it("travels the pending segment and hides a complete bar", () => {
    expect(css).toContain(
      `.${PROGRESS_BAR_CLASS}[data-state="pending"] .${PROGRESS_BAR_BAND_CLASS} > *`,
    );
    expect(css).toContain(`.${PROGRESS_BAR_CLASS}[data-state="complete"]`);
    expect(css).toContain("linear infinite");
    expect(css).toContain("@keyframes progress-bar-travel");
    expect(css).toContain("visibility: hidden");
  });

  it("does not change under reduced motion", () => {
    expect(css).not.toContain("prefers-reduced-motion");
  });
});
