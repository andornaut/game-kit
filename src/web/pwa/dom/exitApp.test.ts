import { expect, it, vi } from "vitest";

import { exitApp, type ExitPage, HOME_URL } from "./exitApp.ts";

it.each([false, true])(
  "exits an installed app=%s without changing its safe exit route",
  (installed) => {
    const close = vi.fn();
    const assign = vi.fn();
    const page: ExitPage = {
      close,
      location: { assign },
      matchMedia: () => ({ matches: installed }),
      navigator: { maxTouchPoints: 5, userAgent: "Android Chrome/142.0" },
    };
    exitApp(page);
    expect(close).toHaveBeenCalledTimes(installed ? 1 : 0);
    expect(assign.mock.calls).toEqual(installed ? [] : [[HOME_URL]]);
  },
);
