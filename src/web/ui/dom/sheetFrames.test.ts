// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { cutFrame, setNineSlice } from "./sheetFrames.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// The canvas the cut draws on: its 2D context's drawImage and the blob it encodes to.
function stubCanvas(blob: Blob | null, context = { drawImage: vi.fn() }) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(blob));
  return context;
}

describe("cutFrame", () => {
  it("draws the frame's rect alone onto a canvas its size and returns its blob: URL", async () => {
    const context = stubCanvas(new Blob(["png"], { type: "image/png" }));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:frame");
    const source = document.createElement("img");
    const url = await cutFrame(document, source, { height: 24, width: 16, x: 32, y: 8 });
    expect(url).toBe("blob:frame");
    expect(create).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(source, 32, 8, 16, 24, 0, 0, 16, 24);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as
      HTMLCanvasElement | undefined;
    expect([canvas?.width, canvas?.height]).toEqual([16, 24]);
  });

  it("rejects when the canvas cannot encode the frame", async () => {
    stubCanvas(null);
    await expect(
      cutFrame(document, document.createElement("img"), { height: 1, width: 1, x: 0, y: 0 }),
    ).rejects.toThrow();
  });
});

describe("setNineSlice", () => {
  it("sets the frame's image and slice insets as its named properties", () => {
    const element = document.createElement("div");
    setNineSlice(
      "ui-button-pressed",
      { slice: { bottom: 6, left: 4, right: 5, top: 3 }, url: "blob:frame" },
      element,
    );
    expect([
      element.style.getPropertyValue("--ui-button-pressed-image"),
      element.style.getPropertyValue("--ui-button-pressed-slice"),
    ]).toEqual(['url("blob:frame")', "3 5 6 4"]);
  });
});
