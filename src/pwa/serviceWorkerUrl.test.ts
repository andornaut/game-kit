import { describe, expect, it } from "vitest";

import { serviceWorkerUrl } from "./serviceWorkerUrl";

describe("serviceWorkerUrl", () => {
  // The page's sound format for the worker to precache, or none when the browser plays neither.
  it("names the sound format, or none", () => {
    for (const [format, url] of [
      ["ogg", "/sw.js?sound=ogg"],
      ["m4a", "/sw.js?sound=m4a"],
      [undefined, "/sw.js"],
    ] as const) {
      expect(serviceWorkerUrl("/sw.js", format)).toBe(url);
    }
  });
});
