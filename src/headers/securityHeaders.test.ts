import { describe, expect, it } from "vitest";

import {
  cspHash,
  headersFile,
  inlineBlocks,
  type PageRule,
  pageRules,
  pathMatches,
  renderPolicy,
  servedPath,
  unhashedAssets,
} from "./securityHeaders";

describe("cspHash", () => {
  it("hashes the CSP specification's example, as a browser does", async () => {
    expect(await cspHash("alert('Hello, world.');")).toBe(
      "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='",
    );
  });
});

describe("inlineBlocks", () => {
  it("returns each inline script and style's exact text and skips scripts with a src", () => {
    const html = `<style>a{}</style>
      <script src="/nav.js" defer></script>
      <script type="module" crossorigin src="/assets/play.js"></script>
      <script>
  run();
</script>
      <STYLE media="screen">\n b {}\n</STYLE>`;
    expect(inlineBlocks(html)).toEqual({
      scripts: ["\n  run();\n"],
      styles: ["a{}", "\n b {}\n"],
    });
    expect(inlineBlocks(`<script data-src="x">go()</script>`).scripts).toEqual(["go()"]);
  });
});

describe("servedPath", () => {
  // index.html at its directory, other pages without .html.
  it("serves index.html at its directory and other pages without .html", () => {
    const files = ["index.html", "play/index.html", "art/notes/example.html"];
    expect(files.map(servedPath)).toEqual(["/", "/play/", "/art/notes/example"]);
  });
});

describe("pathMatches", () => {
  // Without a splat a pattern matches exactly; a splat matches any run, including none;
  // regular expression characters are literal.
  const cases: [string, string, boolean][] = [
    ["/", "/", true],
    ["/", "/play/", false],
    ["/play/*", "/play/", true],
    ["/art/*", "/art/notes/example", true],
    ["/art/*", "/artwork", false],
    ["/a.b", "/a.b", true],
    ["/a.b", "/axb", false],
  ];

  it("matches exactly without a splat, any run with one, and regex characters literally", () => {
    const wrong = cases.filter(
      ([pattern, path, expected]) => pathMatches(pattern, path) !== expected,
    );
    expect(wrong).toEqual([]);
  });
});

describe("unhashedAssets", () => {
  it("lists the files under assets/ whose names carry no 8-character hash", () => {
    expect(
      unhashedAssets("/assets/*", [
        "assets/play-Bq3x_9-Z.js",
        "assets/main-0aZ9bQ1c.css",
        "assets/logo.png",
        "assets/chunk-abc.js",
        "sw.js",
        "art/atlas/run-0.png",
        "play/index.html",
      ]),
    ).toEqual(["assets/logo.png", "assets/chunk-abc.js"]);
  });
});

describe("renderPolicy", () => {
  it("merges layers into directives in the fixed order, each source once, leaving out empty ones", () => {
    const policy = renderPolicy(
      { "default-src": ["'self'"], "style-src": ["'self'"] },
      { "frame-ancestors": ["'none'"], "style-src": ["https://fonts.example", "'self'"] },
    );
    expect(policy).toBe(
      "default-src 'self'; style-src 'self' https://fonts.example; frame-ancestors 'none'",
    );
    expect(renderPolicy({ "script-src": [] }, { "object-src": ["'none'"] })).toBe(
      "object-src 'none'",
    );
  });
});

describe("pageRules", () => {
  const base = { "script-src": ["'self'"], "style-src": ["'self'"] };
  const rules: PageRule[] = [
    { comment: "Home.", directives: { "font-src": ["https://fonts.example"] }, path: "/" },
    { comment: "Art.", directives: {}, path: "/art/*" },
    { comment: "Data.", directives: {}, path: "/data/*" },
  ];
  const policyOf = (emitted: ReturnType<typeof pageRules>, path: string) =>
    emitted.find((rule) => rule.path === path)?.headers[0]?.[1];

  it("gives each rule the hashes of its own pages only, sorted and once each", () => {
    const emitted = pageRules(
      base,
      rules,
      new Map([
        ["/", { scriptHashes: ["'sha256-h'"], styleHashes: ["'sha256-s'"] }],
        ["/art/", { scriptHashes: ["'sha256-b'"], styleHashes: ["'sha256-n'"] }],
        ["/art/notes/x", { scriptHashes: ["'sha256-a'"], styleHashes: ["'sha256-n'"] }],
      ]),
    );
    expect(emitted.map((rule) => [rule.comment, rule.path])).toEqual([
      ["Home.", "/"],
      ["Art.", "/art/*"],
      ["Data.", "/data/*"],
    ]);
    expect(policyOf(emitted, "/")).toBe(
      "script-src 'self' 'sha256-h'; style-src 'self' 'sha256-s'; font-src https://fonts.example",
    );
    expect(policyOf(emitted, "/art/*")).toBe(
      "script-src 'self' 'sha256-a' 'sha256-b'; style-src 'self' 'sha256-n'",
    );
    expect(policyOf(emitted, "/data/*")).toBe("script-src 'self'; style-src 'self'");
  });

  // A page with no policy cannot ship, and the browser would enforce both of two.
  it("throws for a page that no rule or two rules cover", () => {
    const pages = new Map([["/new/", { scriptHashes: [], styleHashes: [] }]]);
    expect(() => pageRules(base, rules, pages)).toThrow("/new/ must match exactly one page rule");
    const overlapping = [...rules, { comment: "All.", directives: {}, path: "/*" }];
    const data = new Map([["/data/", { scriptHashes: [], styleHashes: [] }]]);
    expect(() => pageRules(base, overlapping, data)).toThrow("matches /data/*, /*");
  });
});

describe("headersFile", () => {
  it("writes the heading, then each rule's comment, path and indented headers", () => {
    const text = headersFile("Generated.", [
      { comment: "All.", headers: [["A", "1"]], path: "/*" },
      {
        comment: "Home.",
        headers: [
          ["B", "2"],
          ["C", "3"],
        ],
        path: "/",
      },
    ]);
    expect(text).toBe("# Generated.\n\n# All.\n/*\n  A: 1\n\n# Home.\n/\n  B: 2\n  C: 3\n");
  });
});
