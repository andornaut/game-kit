import { describe, expect, it } from "vitest";

import {
  type Directives,
  headersFile,
  type HeadersRule,
  inlineBlocks,
  type PageNeeds,
  type PageRule,
  pageRules,
  pathMatches,
  renderPolicy,
  servedPath,
  sha256Source,
  unhashedAssets,
  VITE_HASHED_NAME,
} from "./securityHeaders.ts";

describe("sha256Source", () => {
  it("quotes a digest as a CSP hash source", () => {
    expect(sha256Source("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")).toBe(
      "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
    );
  });
});

describe("inlineBlocks", () => {
  it.each<[string, string, { scripts: string[]; styles: string[] }]>([
    ["no blocks", "<p>text</p>", { scripts: [], styles: [] }],
    ["an inline script", "<script>run()</script>", { scripts: ["run()"], styles: [] }],
    ["a module script", `<script type="module">a</script>`, { scripts: ["a"], styles: [] }],
    ["an external script", `<script src="/a.js"></script>`, { scripts: [], styles: [] }],
    ["an unquoted src", "<script defer src=/a.js></script>", { scripts: [], styles: [] }],
    ["an empty script", "<script></script>", { scripts: [""], styles: [] }],
    ["a multi-line style", "<style>\na {}\n</style >", { scripts: [], styles: ["\na {}\n"] }],
    [
      "upper case tags in order",
      "<SCRIPT>b</SCRIPT><style>s</style><script>c</script>",
      { scripts: ["b", "c"], styles: ["s"] },
    ],
  ])("finds %s", (_, html, blocks) => {
    expect(inlineBlocks(html)).toEqual(blocks);
  });
});

describe("servedPath", () => {
  it.each([
    ["index.html", "/"],
    ["play/index.html", "/play/"],
    ["art/notes/example.html", "/art/notes/example"],
    ["about.html", "/about"],
    ["reindex.html", "/reindex"],
  ])("serves %s at %s", (fileName, path) => {
    expect(servedPath(fileName)).toBe(path);
  });
});

describe("pathMatches", () => {
  it.each([
    ["/", "/", true],
    ["/", "/play/", false],
    ["/play/*", "/play/", true],
    ["/play/*", "/play/levels/1", true],
    ["/play/*", "/player", false],
    ["/*.fnt", "/art/fonts/body.fnt", true],
    ["/*.fnt", "/body.fntx", false],
    ["/a.b", "/aXb", false],
    ["/(x)+", "/(x)+", true],
  ])("matches %s against %s: %s", (pattern, path, matches) => {
    expect(pathMatches(pattern, path)).toBe(matches);
  });
});

describe("unhashedAssets", () => {
  it.each<[string, RegExp, string[], string[]]>([
    [
      "Vite names",
      VITE_HASHED_NAME,
      ["assets/play-Bq3x_9-Z.js", "assets/main.css", "index.html"],
      ["assets/main.css"],
    ],
    ["a short hash", VITE_HASHED_NAME, ["assets/a-1234567.js"], ["assets/a-1234567.js"]],
    ["files outside the path", VITE_HASHED_NAME, ["sw.js", "art/a.png"], []],
    [
      "a custom name",
      /\.[0-9a-f]{6}\.\w+$/,
      ["assets/a.0a1b2c.js", "assets/b.js"],
      ["assets/b.js"],
    ],
  ])("finds unhashed files among %s", (_, hashedName, fileNames, unhashed) => {
    expect(unhashedAssets("/assets/*", hashedName, fileNames)).toEqual(unhashed);
  });
});

describe("renderPolicy", () => {
  it.each<[string, Directives[], string]>([
    ["no layers", [], ""],
    ["empty sources", [{ "script-src": [] }], ""],
    [
      "directives in canonical order",
      [{ "base-uri": ["'self'"], "default-src": ["'self'"] }],
      "default-src 'self'; base-uri 'self'",
    ],
    [
      "layers joined without repeats",
      [{ "img-src": ["'self'", "data:"] }, { "img-src": ["data:", "blob:"] }],
      "img-src 'self' data: blob:",
    ],
  ])("renders %s", (_, layers, policy) => {
    expect(renderPolicy(...layers)).toBe(policy);
  });
});

describe("pageRules", () => {
  const base: Directives = { "default-src": ["'self'"], "script-src": ["'self'"] };
  const home: PageRule = { comment: "Home.", directives: { "font-src": ["f"] }, path: "/" };
  const play: PageRule = { comment: "Play.", directives: {}, path: "/play/*" };
  const none: PageNeeds = { scriptHashes: [], styleHashes: [] };
  const csp = (rule: HeadersRule) => rule.headers.map(([, value]) => value);

  it.each<[string, [string, PageNeeds][], string[]]>([
    [
      "rules without pages",
      [],
      [
        "default-src 'self'; script-src 'self'; font-src f",
        "default-src 'self'; script-src 'self'",
      ],
    ],
    [
      "sorted hashes from every page of a rule",
      [
        ["/play/b", { scriptHashes: ["'sha256-b'"], styleHashes: ["'sha256-s'"] }],
        ["/play/", { scriptHashes: ["'sha256-a'"], styleHashes: [] }],
        ["/", none],
      ],
      [
        "default-src 'self'; script-src 'self'; font-src f",
        "default-src 'self'; script-src 'self' 'sha256-a' 'sha256-b'; style-src 'sha256-s'",
      ],
    ],
  ])("renders %s", (_, pages, policies) => {
    const rules = pageRules(base, [home, play], new Map(pages));
    expect(rules.map(({ comment, path }) => [comment, path])).toEqual([
      ["Home.", "/"],
      ["Play.", "/play/*"],
    ]);
    expect(rules.flatMap(csp)).toEqual(policies);
  });

  it.each<[string, PageRule[], string]>([
    ["no rule", [home], "/play/ must match exactly one page rule, but matches none"],
    [
      "two rules",
      [play, { ...play, path: "/*" }],
      "/play/ must match exactly one page rule, but matches /play/*, /*",
    ],
  ])("throws for a page matching %s", (_, rules, message) => {
    expect(() => pageRules(base, rules, new Map([["/play/", none]]))).toThrow(message);
  });
});

describe("headersFile", () => {
  it.each<[string, HeadersRule[], string]>([
    ["no rules", [], "# Heading.\n"],
    [
      "rules with indented headers",
      [
        {
          comment: "All.",
          headers: [
            ["X-Content-Type-Options", "nosniff"],
            ["Referrer-Policy", "no-referrer"],
          ],
          path: "/*",
        },
        {
          comment: "Home.",
          headers: [["Content-Security-Policy", "default-src 'self'"]],
          path: "/",
        },
      ],
      "# Heading.\n\n# All.\n/*\n  X-Content-Type-Options: nosniff\n" +
        "  Referrer-Policy: no-referrer\n\n# Home.\n/\n  Content-Security-Policy: default-src 'self'\n",
    ],
  ])("renders %s", (_, rules, file) => {
    expect(headersFile("Heading.", rules)).toBe(file);
  });
});
