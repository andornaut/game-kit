// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  LayoutColumnSizing,
  LayoutMeasurement,
  LayoutNode,
} from "../../../../ui/layout/layoutTree.ts";
import { type LayoutComponentPorts, type LayoutOptions, mountLayout } from "./layoutTree.ts";

type Schema = {
  card: { props: { title: string }; slots: "header" | "body" | "footer" };
  button: { props: { label: string }; slots: never };
  text: { props: { label: string }; slots: never };
};

function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const buttons: HTMLButtonElement[] = [];
  const disposeButton = vi.fn();
  const disposeCard = vi.fn();
  const disposeText = vi.fn();
  const updateButton = vi.fn();
  const components: LayoutComponentPorts<Schema> = {
    button: {
      create: vi.fn(({ label }) => {
        const element = document.createElement("button");
        element.textContent = label;
        buttons.push(element);
        return {
          dispose: disposeButton,
          element,
          slots: {},
          update(props: Schema["button"]["props"]) {
            updateButton(props);
            element.textContent = props.label;
          },
        };
      }),
      slots: [],
    },
    card: {
      create: vi.fn(({ title }) => {
        const element = document.createElement("section");
        element.setAttribute("aria-label", title);
        const header = document.createElement("header");
        const body = document.createElement("main");
        const footer = document.createElement("footer");
        const authored = document.createElement("span");
        authored.textContent = "Authored card content";
        body.append(authored);
        element.append(header, body, footer);
        return {
          dispose: disposeCard,
          element,
          slots: { body, footer, header },
          update(props: Schema["card"]["props"]) {
            element.setAttribute("aria-label", props.title);
          },
        };
      }),
      slots: ["header", "body", "footer"],
    },
    text: {
      create: vi.fn(({ label }) => {
        const element = document.createElement("p");
        element.textContent = label;
        return {
          dispose: disposeText,
          element,
          slots: {},
          update(props: Schema["text"]["props"]) {
            element.textContent = props.label;
          },
        };
      }),
      slots: [],
    },
  };
  return { buttons, components, disposeButton, disposeCard, disposeText, host, updateButton };
}

const button = (key: string, label = key): LayoutNode<Schema> => ({
  component: "button",
  key,
  kind: "component",
  props: { label },
});
const group = (
  children: readonly LayoutNode<Schema>[],
  kind: "row" | "stack" | "columns" = "row",
): LayoutNode<Schema> => ({ children, gap: 8, key: "group", kind, padding: 4 });
const viewport = { height: 80, width: 120, x: 0, y: 0 };
const measured: LayoutMeasurement = {
  available: viewport,
  clipped: false,
  overlaps: [],
  required: viewport,
  wrappedLines: [],
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("caller component composition", () => {
  it("changes column sizing through custom properties while preserving keyed components and focus", () => {
    const { buttons, components, disposeButton, host } = fixture();
    const tree = {
      children: [button("a"), button("b")],
      gap: 4,
      key: "columns",
      kind: "columns" as const,
      padding: 2,
    };
    const mounted = mountLayout({ components, host }, { ...tree, sizing: { mode: "equal" } });
    const element = host.firstElementChild as HTMLElement;
    const first = buttons[0]!;
    first.focus();
    expect(element.dataset.uiLayoutSizing).toBe("equal");
    expect(element.style.getPropertyValue("--ui-layout-tracks")).toBe("repeat(2, minmax(0, 1fr))");
    mounted.update({
      ...tree,
      sizing: { mode: "tracks", tracks: [{ kind: "fixed", size: 3.5 }, { kind: "fraction" }] },
    });
    expect(element.style.getPropertyValue("--ui-layout-tracks")).toBe(
      "calc(3.5 * var(--ui-unit, 1) * 1px) minmax(0, 1fr)",
    );
    mounted.update({ ...tree, sizing: { mode: "intrinsic" } });
    expect(element.style.getPropertyValue("--ui-layout-tracks")).toBe("repeat(2, max-content)");
    mounted.update(tree);
    expect(element.hasAttribute("data-ui-layout-sizing")).toBe(false);
    expect(element.style.getPropertyValue("--ui-layout-tracks")).toBe("");
    expect(host.firstElementChild).toBe(element);
    expect(document.activeElement).toBe(first);
    expect(host.querySelector("button")).toBe(first);
    expect(components.button.create).toHaveBeenCalledTimes(2);
    expect(disposeButton).not.toHaveBeenCalled();
    expect(mounted.inspect(viewport).status).toBe("unavailable");
    mounted.dispose();
  });

  it("rejects nested invalid columns before factories, focus or CSS change", () => {
    const { buttons, components, host, updateButton } = fixture();
    const mounted = mountLayout({ components, host }, group([button("a")]));
    buttons[0]!.focus();
    const before = host.innerHTML;
    for (const sizing of [
      { mode: "tracks", tracks: [] },
      { mode: "tracks", tracks: [{ kind: "fixed", size: -1 }] },
      { mode: "other" },
    ]) {
      expect(() =>
        mounted.update(
          group([
            button("a", "Must not update"),
            {
              children: [button("new")],
              gap: 2,
              key: "nested",
              kind: "columns",
              padding: 1,
              sizing: sizing as LayoutColumnSizing,
            },
          ]),
        ),
      ).toThrow(RangeError);
      expect(host.innerHTML).toBe(before);
      expect(document.activeElement).toBe(buttons[0]);
      expect(components.button.create).toHaveBeenCalledOnce();
      expect(updateButton).not.toHaveBeenCalled();
    }
    mounted.dispose();
  });

  it("updates and reorders keyed components without replacing focused DOM or listeners", () => {
    const { buttons, components, disposeButton, host, updateButton } = fixture();
    const mounted = mountLayout({ components, host }, group([button("a"), button("b")]));
    const first = buttons[0]!;
    const clicked = vi.fn();
    first.addEventListener("click", clicked);
    first.focus();
    mounted.update(group([button("b"), button("a", "Renamed")]));
    expect(document.activeElement).toBe(first);
    expect(host.querySelectorAll("button")[1]).toBe(first);
    expect(first.textContent).toBe("Renamed");
    first.click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(components.button.create).toHaveBeenCalledTimes(2);
    expect(updateButton).toHaveBeenCalledWith({ label: "Renamed" });
    expect(disposeButton).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("preserves named slot destinations, independent key scopes and authored slot content", () => {
    const { components, disposeButton, host } = fixture();
    const tree: LayoutNode<Schema> = {
      component: "card",
      key: "card",
      kind: "component",
      props: { title: "Title" },
      slots: {
        body: [button("same", "Body")],
        footer: [button("same", "Footer")],
        header: [button("same", "Header")],
      },
    };
    const mounted = mountLayout({ components, host }, tree);
    const bodyButton = host.querySelector("main button");
    const footerButton = host.querySelector("footer button");
    expect(host.querySelector("header button")!.textContent).toBe("Header");
    mounted.update({
      ...tree,
      props: { title: "Updated" },
      slots: { body: [button("same", "Updated body")] },
    });
    expect(host.querySelector("main button")).toBe(bodyButton);
    expect(host.querySelector("main span")!.textContent).toBe("Authored card content");
    expect(host.querySelector("section")!.getAttribute("aria-label")).toBe("Updated");
    expect(footerButton!.isConnected).toBe(false);
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(disposeButton).toHaveBeenCalledTimes(2);
    mounted.dispose();
  });

  it("disposes replaced kinds, changed component names and removed subtrees exactly once", () => {
    const { components, disposeButton, disposeCard, disposeText, host } = fixture();
    const tree: LayoutNode<Schema> = {
      component: "card",
      key: "card",
      kind: "component",
      props: { title: "Title" },
      slots: { body: [button("a")] },
    };
    const mounted = mountLayout({ components, host }, tree);
    mounted.update({ children: [button("a")], gap: 0, key: "card", kind: "stack", padding: 0 });
    expect(disposeCard).toHaveBeenCalledOnce();
    expect(disposeButton).toHaveBeenCalledOnce();
    mounted.update({
      children: [{ component: "text", key: "a", kind: "component", props: { label: "Copy" } }],
      gap: 0,
      key: "card",
      kind: "stack",
      padding: 0,
    });
    expect(disposeButton).toHaveBeenCalledTimes(2);
    mounted.update({ children: [], gap: 0, key: "card", kind: "stack", padding: 0 });
    expect(disposeText).toHaveBeenCalledOnce();
    mounted.dispose();
    mounted.dispose();
    expect(disposeText).toHaveBeenCalledOnce();
    expect(disposeCard).toHaveBeenCalledOnce();
    expect(disposeButton).toHaveBeenCalledTimes(2);
    expect(() => mounted.update(tree)).toThrow(/disposed/);
    expect(() => mounted.inspect(viewport)).toThrow(/disposed/);
  });

  it("returns removed focus to the caller using the old keyed path", () => {
    const { buttons, components, host } = fixture();
    const outside = document.createElement("button");
    document.body.append(outside);
    const restoreFocus = vi.fn(() => outside.focus());
    const mounted = mountLayout({ components, host, restoreFocus }, button("old"));
    buttons[0]!.focus();
    mounted.update(button("new"));
    expect(restoreFocus).toHaveBeenCalledWith(["old"]);
    expect(document.activeElement).toBe(outside);
    mounted.dispose();
  });

  it("validates the entire update before calling factories or mutating existing DOM", () => {
    const { buttons, components, disposeButton, host } = fixture();
    const mounted = mountLayout({ components, host }, group([button("a")]));
    buttons[0]!.focus();
    const original = host.innerHTML;
    for (const invalid of [
      group([button("new"), button("new")]),
      group([button("new"), { children: [], gap: NaN, key: "bad", kind: "columns", padding: 0 }]),
      group([button("new"), { children: [], gap: 0, key: "bad", kind: "stack", padding: -1 }]),
      group([button("new"), { ...button("bad"), slots: { missing: [] } } as LayoutNode<Schema>]),
    ]) {
      expect(() => mounted.update(invalid)).toThrow();
      expect(host.innerHTML).toBe(original);
      expect(document.activeElement).toBe(buttons[0]);
      expect(components.button.create).toHaveBeenCalledOnce();
      expect(disposeButton).not.toHaveBeenCalled();
    }
    mounted.dispose();
  });

  it("leaves pre-existing host nodes intact and disposes only its own instances", () => {
    const { components, host } = fixture();
    const existing = document.createElement("aside");
    host.append(existing);
    const mounted = mountLayout({ components, host }, button("a"));
    mounted.dispose();
    expect([...host.children]).toEqual([existing]);
  });

  it("rejects port slots outside their component and cleans up the rejected instance", () => {
    const { components, host } = fixture();
    const dispose = vi.fn();
    components.card.create = vi.fn(() => ({
      dispose,
      element: document.createElement("section"),
      slots: { body: document.createElement("main"), footer: host, header: host },
      update: vi.fn(),
    }));
    expect(() =>
      mountLayout(
        { components, host },
        {
          component: "card",
          key: "card",
          kind: "component",
          props: { title: "Title" },
        },
      ),
    ).toThrow(/within/);
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.children).toHaveLength(0);
  });
});

describe("physical measurements and overflow", () => {
  it("cannot establish fit from a headless DOM when the measurement port is absent", () => {
    const { components, host } = fixture();
    const mounted = mountLayout({ components, host }, group([button("a")]));
    const report = mounted.inspect(viewport);
    expect(report.status).toBe("unavailable");
    expect(report.diagnostics.map(({ path }) => path)).toEqual([["group"], ["group", "a"]]);
    expect(
      report.diagnostics.every(
        ({ available, required }) => available === null && required === null,
      ),
    ).toBe(true);
    mounted.dispose();
  });

  it("passes actual component elements and named-slot paths to the same measurement port", () => {
    const { components, host } = fixture();
    const measure = vi.fn<NonNullable<LayoutOptions<Schema>["measure"]>>(() => measured);
    const tree: LayoutNode<Schema> = {
      component: "card",
      key: "card",
      kind: "component",
      props: { title: "Title" },
      slots: { body: [button("a")] },
    };
    const mounted = mountLayout({ components, host, measure }, tree);
    expect(mounted.inspect(viewport)).toEqual({ diagnostics: [], status: "fit" });
    expect(measure).toHaveBeenCalledWith(
      { path: ["card", "body", "a"], viewport },
      host.querySelector("button"),
    );
    measure.mockReturnValueOnce(null);
    expect(mounted.inspect(viewport).status).toBe("unavailable");
    mounted.dispose();
  });

  it("reports overflow, wrapped lines, clipping and overlap without changing rendered content", () => {
    const { components, host } = fixture();
    const required = { ...viewport, width: 200 };
    const wrappedLines = [{ height: 30, width: 160, x: 0, y: 0 }];
    const mounted = mountLayout(
      {
        components,
        host,
        measure: () => ({
          ...measured,
          clipped: true,
          overlaps: [["peer"]],
          required,
          wrappedLines,
        }),
      },
      button("a", "Keep full authored label"),
    );
    const before = host.innerHTML;
    const report = mounted.inspect(viewport);
    expect(report.status).toBe("overflow");
    expect(report.diagnostics.map(({ kind }) => kind)).toEqual(["overflow", "clip", "overlap"]);
    expect(report.diagnostics[0]).toMatchObject({
      available: viewport,
      path: ["a"],
      required,
      viewport,
      wrappedLines,
    });
    expect(host.innerHTML).toBe(before);
    expect(host.textContent).toBe("Keep full authored label");
    mounted.dispose();
  });

  it("applies explicit metrics and placement without adding fit-by-clipping styles", () => {
    const { components, host } = fixture();
    const mounted = mountLayout({ components, host }, group([button("a"), button("b")], "columns"));
    const container = host.firstElementChild as HTMLElement;
    expect(container.style.getPropertyValue("--ui-layout-gap")).toBe("8");
    expect(container.style.getPropertyValue("--ui-layout-padding")).toBe("4");
    expect(container.style.getPropertyValue("--ui-layout-columns")).toBe("2");
    expect(container.dataset.uiLayoutAlign).toBe("top");
    mounted.update({ ...group([button("a")], "columns"), align: "baseline" } as LayoutNode<Schema>);
    expect(container.dataset.uiLayoutAlign).toBe("baseline");
    const css = readFileSync("src/web/ui/dom/layout/layoutTree.css", "utf8");
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const rules = [...sheet.cssRules] as CSSStyleRule[];
    expect(
      rules.some(
        ({ selectorText, style }) =>
          selectorText.includes(".ui-layout-columns") &&
          style.getPropertyValue("width") === "max-content" &&
          style.getPropertyValue("min-width") === "100%",
      ),
    ).toBe(true);
    expect(
      rules.some(
        ({ style }) => style.getPropertyValue("grid-auto-columns") === "minmax(max-content, 1fr)",
      ),
    ).toBe(true);
    expect(rules.some(({ style }) => style.getPropertyValue("justify-self") === "stretch")).toBe(
      true,
    );
    expect(
      rules.some(
        ({ selectorText, style }) =>
          selectorText.includes('data-ui-layout-align="center"') &&
          style.getPropertyValue("align-items") === "center",
      ),
    ).toBe(true);
    for (const { style } of rules) {
      for (const name of [
        "overflow",
        "overflow-x",
        "overflow-y",
        "font-size",
        "text-overflow",
        "transform",
        "max-height",
        "max-width",
      ]) {
        expect(style.getPropertyValue(name)).toBe("");
      }
    }
    mounted.dispose();
  });
});
