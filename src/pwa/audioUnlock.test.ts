import { describe, expect, it, vi } from "vitest";

import { AUDIO_UNLOCK_EVENTS, unlockAudioOnFirstGesture } from "./audioUnlock.ts";

describe("audio gesture unlock", () => {
  it("retries rejected resumes and removes every listener after running", async () => {
    const target = new EventTarget();
    const context = { resume: vi.fn(async () => {}), state: "suspended" };
    context.resume.mockRejectedValueOnce(new Error("blocked"));
    unlockAudioOnFirstGesture(target, context);
    target.dispatchEvent(new Event("touchend"));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(context.resume).toHaveBeenCalledTimes(1);
    context.resume.mockImplementation(async () => {
      context.state = "running";
    });
    target.dispatchEvent(new Event("pointerup"));
    await Promise.resolve();
    for (const type of AUDIO_UNLOCK_EVENTS) {
      target.dispatchEvent(new Event(type));
    }
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("keeps listening if resume resolves without running", async () => {
    const target = new EventTarget();
    const context = { resume: vi.fn(async () => {}), state: "suspended" };
    const stop = unlockAudioOnFirstGesture(target, context);
    target.dispatchEvent(new Event("keydown"));
    await Promise.resolve();
    target.dispatchEvent(new Event("mousedown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
    stop();
    target.dispatchEvent(new Event("touchend"));
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("does not resume audio already running, initially or before a gesture", () => {
    const target = new EventTarget();
    const context = { resume: vi.fn(async () => {}), state: "running" };
    unlockAudioOnFirstGesture(target, context)();
    target.dispatchEvent(new Event("touchend"));
    context.state = "suspended";
    unlockAudioOnFirstGesture(target, context);
    context.state = "running";
    target.dispatchEvent(new Event("touchend"));
    expect(context.resume).not.toHaveBeenCalled();
  });
});
