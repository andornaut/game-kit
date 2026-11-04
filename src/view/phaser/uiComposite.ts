import type { RgbaImage } from "../../art/rgbaImage.ts";
import {
  presentUi,
  releaseUiTintCache,
  type UiCompositePorts,
  type UiCompositeRequest,
  type UiSnapshotResult,
  type UiWorldReadContext,
  type UiWorldReadRequest,
  type UiWorldReadResult,
} from "./uiCommands.ts";

export function readUiWorldFrame(
  context: UiWorldReadContext,
  request: UiWorldReadRequest,
): UiWorldReadResult {
  const { captureSize, gl } = context;
  const unavailable = (
    reason: Extract<UiWorldReadResult, { status: "unavailable" }>["reason"],
  ): UiWorldReadResult => ({ reason, status: "unavailable" });
  if (
    context.phase !== "post-render" ||
    context.frameId !== request.frameId ||
    captureSize.width !== gl.drawingBufferWidth ||
    captureSize.height !== gl.drawingBufferHeight
  ) {
    return unavailable("frame");
  }
  const { height, width, x, y } = request.area;
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > captureSize.width ||
    y + height > captureSize.height
  ) {
    return unavailable("bounds");
  }
  try {
    if (gl.isContextLost()) {
      return unavailable("context");
    }
    if (
      gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null ||
      ("READ_FRAMEBUFFER_BINDING" in gl && gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) !== null)
    ) {
      return unavailable("framebuffer");
    }
    if (gl.getError() !== gl.NO_ERROR) {
      return unavailable("readback");
    }
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(
      x,
      captureSize.height - y - height,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      raw,
    );
    if (gl.isContextLost()) {
      return unavailable("context");
    }
    if (gl.getError() !== gl.NO_ERROR) {
      return unavailable("readback");
    }
    const data = new Uint8Array(raw.length);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const from = ((height - row - 1) * width + column) * 4;
        const to = (row * width + column) * 4;
        const alpha = context.alphaMode === "opaque" ? 255 : raw[from + 3]!;
        for (let channel = 0; channel < 3; channel++) {
          data[to + channel] =
            context.alphaMode === "premultiplied"
              ? alpha === 0
                ? 0
                : Math.min(255, Math.floor((raw[from + channel]! * 255) / alpha))
              : raw[from + channel]!;
        }
        data[to + 3] = alpha;
      }
    }
    return {
      capture: {
        captureArea: { ...request.area },
        frameId: request.frameId,
        pixels: { data, height, width },
      },
      status: "captured",
    };
  } catch (cause) {
    return { cause, reason: "readback", status: "unavailable" };
  }
}

export function createUiCompositor(ports: UiCompositePorts): {
  capture(request: UiCompositeRequest): UiSnapshotResult;
  destroy(): void;
} {
  let disposed = false;
  return {
    capture(request) {
      if (disposed) {
        return { status: "disposed" };
      }
      const world = ports.captureWorld({ area: request.area, frameId: request.frame.id });
      if (disposed) {
        return { status: "disposed" };
      }
      if (world.status !== "captured") {
        return world;
      }
      const { capture } = world;
      if (
        capture.frameId !== request.frame.id ||
        ["x", "y", "width", "height"].some(
          (key) =>
            capture.captureArea[key as keyof typeof capture.captureArea] !==
            request.area[key as keyof typeof request.area],
        )
      ) {
        return { reason: "frame", status: "unavailable" };
      }
      const { projection } = request.frame;
      const width = Math.ceil(request.area.width * projection.scaleX);
      const height = Math.ceil(request.area.height * projection.scaleY);
      const surfaces: CanvasRenderingContext2D[] = [];
      const surface = (w: number, h: number) => {
        const ctx = ports.createSurface({ height: h, width: w });
        surfaces.push(ctx);
        return ctx;
      };
      try {
        const raw = surface(capture.pixels.width, capture.pixels.height);
        const image = raw.createImageData(capture.pixels.width, capture.pixels.height);
        image.data.set(capture.pixels.data);
        raw.putImageData(image, 0, 0);
        const overlay = surface(projection.backingSize.width, projection.backingSize.height);
        presentUi(
          {
            context: overlay,
            createSurface: ports.createSurface,
            releaseSurface: ports.releaseSurface,
            resizeBacking: (size) => {
              overlay.canvas.width = size.width;
              overlay.canvas.height = size.height;
            },
          },
          {
            ...request.frame,
            commands: request.frame.commands.filter(
              (command) => command.kind === "viewport-clip" || !request.exclude.has(command.owner),
            ),
          },
        );
        const output = surface(width, height);
        output.setTransform(1, 0, 0, 1, 0, 0);
        output.clearRect(0, 0, width, height);
        output.globalAlpha = 1;
        output.globalCompositeOperation = "source-over";
        output.imageSmoothingEnabled = false;
        output.drawImage(raw.canvas, 0, 0, width, height);
        output.drawImage(
          overlay.canvas,
          request.area.x * projection.scaleX,
          request.area.y * projection.scaleY,
          request.area.width * projection.scaleX,
          request.area.height * projection.scaleY,
          0,
          0,
          width,
          height,
        );
        const pixels: RgbaImage = {
          data: new Uint8Array(output.getImageData(0, 0, width, height).data),
          height,
          width,
        };
        if (disposed) {
          return { status: "disposed" };
        }
        ports.remap(pixels);
        return disposed
          ? { status: "disposed" }
          : {
              captureArea: { ...request.area },
              frameId: request.frame.id,
              pixels,
              status: "captured",
            };
      } catch (cause) {
        return { cause, reason: "raster", status: "unavailable" };
      } finally {
        for (const ctx of surfaces.reverse()) {
          ports.releaseSurface(ctx);
        }
      }
    },
    destroy() {
      disposed = true;
      releaseUiTintCache(ports);
    },
  };
}
