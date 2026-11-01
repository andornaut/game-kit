import { expect, it } from "vitest";

import { createDomProgressBar } from "./progressBar.ts";

class Element {
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  readonly dataset: Record<string, string> = {};
  readonly ownerDocument = { createElement: () => new Element() };
  readonly style: Record<string, string> = {};
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

it("renders the shared pixel geometry and omits a percentage while pending", () => {
  const parent = new Element();
  const bar = createDomProgressBar(
    parent as unknown as HTMLElement,
    { border: 1, fills: [0xffff00, 0xffaa00], frame: 0, track: 0x333333 },
    { height: 4, width: 102, x: 10, y: 20 },
  );
  const element = parent.children[0];
  expect(element?.attributes.get("role")).toBe("progressbar");
  expect(element?.attributes.has("aria-valuenow")).toBe(false);
  bar.update(0.339);
  expect(element?.attributes.get("aria-valuenow")).toBe("0.339");
  expect(element?.children[1]?.style).toMatchObject({
    backgroundColor: "#ffff00",
    height: "1px",
    left: "1px",
    top: "1px",
    width: "33px",
  });
  bar.update(undefined);
  expect(element?.attributes.has("aria-valuenow")).toBe(false);
  expect(element?.dataset.state).toBe("pending");
  bar.remove();
  expect(element?.removed).toBe(true);
});
