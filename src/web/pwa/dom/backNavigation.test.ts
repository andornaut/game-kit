import { describe, expect, it, vi } from "vitest";

import { guardBackNavigation } from "./backNavigation.ts";

describe("guardBackNavigation", () => {
  it("uses the injected history to restore the guard on back", () => {
    const target = new EventTarget();
    const history = {
      length: 1,
      pushState: vi.fn((state: unknown) => {
        history.state = state;
      }),
      state: null as unknown,
    };
    const onBack = vi.fn();
    guardBackNavigation(
      {
        createCloseWatcher: undefined,
        history,
        onBack,
        stateKey: "gameGuard",
        timer: { setTimeout: vi.fn() },
      },
      target,
    );

    expect(history.pushState).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("pointerup"));
    expect(history.pushState).toHaveBeenCalledWith({ gameGuard: true }, "");

    history.state = null;
    target.dispatchEvent(new Event("popstate"));
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(history.state).toEqual({ gameGuard: true });
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("uses the injected close watcher and timer to suppress only the Escape close", () => {
    const target = new EventTarget();
    const first = new EventTarget();
    const second = new EventTarget();
    const createCloseWatcher = vi
      .fn(() => new EventTarget())
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const history = { length: 1, pushState: vi.fn(), state: null };
    const onBack = vi.fn();
    const setTimeout = vi.fn<(handler: () => void, ms: number) => void>();
    guardBackNavigation(
      { createCloseWatcher, history, onBack, stateKey: "gameGuard", timer: { setTimeout } },
      target,
    );

    expect(createCloseWatcher).toHaveBeenCalledOnce();
    target.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    first.dispatchEvent(new Event("close"));
    expect(onBack).not.toHaveBeenCalled();
    expect(createCloseWatcher).toHaveBeenCalledTimes(2);

    setTimeout.mock.calls[0]?.[0]();
    second.dispatchEvent(new Event("close"));
    expect(onBack).toHaveBeenCalledOnce();
    expect(history.pushState).not.toHaveBeenCalled();
  });
});
