import { expect, it } from "vitest";

import { serviceWorkerUrl, SOUND_FORMAT_PARAM } from "./serviceWorkerUrl.ts";

it.each<[string, string | undefined, string]>([
  ["/sw.js", "ogg", "/sw.js?sound=ogg"],
  ["/sw.js", "m4a", "/sw.js?sound=m4a"],
  ["/sw.js", undefined, "/sw.js"],
  ["/game/worker.js", "ogg", "/game/worker.js?sound=ogg"],
])("names %s's sound format %s as %s", (scriptUrl, format, url) => {
  expect(serviceWorkerUrl(scriptUrl, format)).toBe(url);
  expect(new URL(url, "https://game.test").searchParams.get(SOUND_FORMAT_PARAM)).toBe(
    format ?? null,
  );
});
