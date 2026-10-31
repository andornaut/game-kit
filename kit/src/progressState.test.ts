import { describe, expect, it } from "vitest";

import { createProgressState, type ProgressSnapshot } from "./progressState";

describe("createProgressState", () => {
  it("ignores stale progress and completion after another operation starts", () => {
    const state = createProgressState();
    const seen: ProgressSnapshot[] = [];
    state.subscribe((snapshot) => seen.push(snapshot));
    const first = state.begin();
    first.progress(0.5);
    const next = state.begin();
    first.progress(1);
    first.finish();
    expect(seen.at(-1)).toEqual({ active: true, value: undefined });
    next.progress(2);
    expect(seen.at(-1)).toEqual({ active: true, value: 1 });
    next.finish();
    next.progress(0.5);
    expect(seen.at(-1)).toEqual({ active: false, value: undefined });
  });

  it("immediately subscribes to current work and stops reports after unsubscribe", () => {
    const state = createProgressState();
    const handle = state.begin();
    handle.progress(0.5);
    const seen: ProgressSnapshot[] = [];
    const unsubscribe = state.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toEqual([{ active: true, value: 0.5 }]);
    unsubscribe();
    handle.finish();
    expect(seen).toHaveLength(1);
  });
});
