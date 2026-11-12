// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buttonSkinProperty, createButtonSkin } from "./buttonSkin.ts";

const BASE = `${location.origin}/art/ui/`;
const MANIFEST = `${BASE}manifest.json`;

const SOURCE = {
  manifestUrl: "/art/ui/manifest.json",
  sheets: ["ui-button", "ui-button-primary"],
  tags: ["normal", "pressed"],
};

const frame = (x: number) => ({ duration: 100, frame: { h: 8, w: 16, x, y: 4 } });
const tag = (name: string, from: number, to = from, direction = "forward") => ({
  direction,
  from,
  name,
  to,
});

// A sheet whose frames sit side by side, 16 px apart, with a normal and a pressed tag.
const sheet = (tags = [tag("normal", 0), tag("pressed", 1)]) => ({
  frames: { "b 0.aseprite": frame(0), "b 1.aseprite": frame(16), "b 2.aseprite": frame(32) },
  meta: { frameTags: tags },
});

const sprite = (key: string) => ({ json: `${key}.json`, key, png: `${key}.png` });

// Responses by URL; a URL with none answers 404.
let responses: Map<string, unknown>;
let fetched: string[];
let decoded: string[];
let failingImages: Set<string>;
let drawn: number[][];
let created: number;

beforeEach(() => {
  responses = new Map<string, unknown>([
    [MANIFEST, { sprites: [sprite("ui-button"), sprite("ui-button-primary")] }],
    [`${BASE}ui-button.json`, sheet()],
    [`${BASE}ui-button-primary.json`, sheet()],
  ]);
  fetched = [];
  decoded = [];
  failingImages = new Set();
  drawn = [];
  created = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      fetched.push(url);
      const body = responses.get(url);
      return Promise.resolve({
        json: () => Promise.resolve(body),
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
      });
    }),
  );
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (
    this: HTMLImageElement,
  ) {
    const url = this.getAttribute("src") ?? "";
    decoded.push(url);
    return failingImages.has(url) ? Promise.reject(new Error(url)) : Promise.resolve();
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: (_source: unknown, ...args: number[]) => drawn.push(args.slice(0, 4)),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${created++}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const property = (root: HTMLElement, sheetKey: string, tagName: string) =>
  root.style.getPropertyValue(buttonSkinProperty(sheetKey, tagName));

describe("createButtonSkin", () => {
  it("fetches and cuts each sheet once, however many roots it is applied to", async () => {
    const skin = createButtonSkin(document, SOURCE);
    const first = document.createElement("div");
    const second = document.createElement("div");
    const [firstUrls, secondUrls] = await Promise.all([skin.apply(first), skin.apply(second)]);
    await skin.apply(document.createElement("div"));
    expect([...fetched].sort()).toEqual([
      MANIFEST,
      `${BASE}ui-button-primary.json`,
      `${BASE}ui-button.json`,
    ]);
    expect([...decoded].sort()).toEqual([`${BASE}ui-button-primary.png`, `${BASE}ui-button.png`]);
    expect(created).toBe(4);
    expect(secondUrls).toEqual(firstUrls);
    expect(property(second, "ui-button-primary", "pressed")).toBe(
      property(first, "ui-button-primary", "pressed"),
    );
  });

  it("sets each wanted tag's cut frame as --<sheet>-<tag>, and resolves to the URLs set", async () => {
    responses.set(`${BASE}ui-button.json`, sheet([tag("normal", 0), tag("disabled", 2)]));
    const root = document.createElement("div");
    const urls = await createButtonSkin(document, SOURCE).apply(root);
    const values = [
      property(root, "ui-button", "normal"),
      property(root, "ui-button", "pressed"),
      property(root, "ui-button", "disabled"),
    ];
    expect(values[0]).toMatch(/^url\("blob:\d+"\)$/);
    expect(values.slice(1)).toEqual(["", ""]);
    expect(urls).toHaveLength(3);
    expect(urls).toContain(values[0]?.slice(5, -2));
  });

  it("cuts the first frame each tag plays, by the export's frame order", async () => {
    responses.set(
      `${BASE}ui-button.json`,
      sheet([tag("normal", 1, 2), tag("pressed", 0, 2, "reverse")]),
    );
    const source = { ...SOURCE, sheets: ["ui-button"] };
    const frames = await createButtonSkin(document, source).frames;
    expect(drawn.map(([x]) => x ?? 0).sort((a, b) => a - b)).toEqual([16, 32]);
    expect(drawn[0]?.slice(1)).toEqual([4, 16, 8]);
    expect([...frames.keys()].sort()).toEqual(["--ui-button-normal", "--ui-button-pressed"]);
  });

  it("leaves a sheet the manifest lacks unset and applies the others", async () => {
    responses.set(MANIFEST, { sprites: [sprite("ui-button-primary")] });
    const root = document.createElement("div");
    await createButtonSkin(document, SOURCE).apply(root);
    expect(property(root, "ui-button", "normal")).toBe("");
    expect(property(root, "ui-button-primary", "normal")).not.toBe("");
    expect(fetched).not.toContain(`${BASE}ui-button.json`);
  });

  it("leaves a sheet whose JSON, image or shape fails unset and applies the others", async () => {
    const sheets = ["ui-button", "ui-button-primary", "ui-button-tile", "ui-button-wide"];
    responses.set(MANIFEST, { sprites: sheets.map(sprite) });
    responses.delete(`${BASE}ui-button-primary.json`);
    responses.set(`${BASE}ui-button-tile.json`, { frames: { a: { duration: 1 } }, meta: {} });
    responses.set(`${BASE}ui-button-wide.json`, sheet());
    failingImages.add(`${BASE}ui-button-wide.png`);
    const root = document.createElement("div");
    const urls = await createButtonSkin(document, { ...SOURCE, sheets }).apply(root);
    expect(sheets.map((key) => property(root, key, "normal") !== "")).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(urls).toHaveLength(2);
  });

  it("applies nothing and requests nothing again when the manifest fails", async () => {
    responses.delete(MANIFEST);
    const skin = createButtonSkin(document, SOURCE);
    const root = document.createElement("div");
    const urls = await skin.apply(root);
    await skin.apply(root);
    expect([urls, fetched, root.style.length]).toEqual([[], [MANIFEST], 0]);
  });

  it("requests everything again for a new skin", async () => {
    responses.delete(MANIFEST);
    await createButtonSkin(document, SOURCE).frames;
    await createButtonSkin(document, SOURCE).frames;
    expect(fetched).toEqual([MANIFEST, MANIFEST]);
  });
});
