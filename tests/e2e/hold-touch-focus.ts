// Run node tests/e2e/hold-touch-focus.ts [--hold] in the stock Playwright container.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";
import { createServer } from "vite";

interface TraceEntry {
  readonly name: string;
  readonly focus: string;
  readonly target?: string;
  readonly trusted?: boolean;
  readonly touch?: boolean | undefined;
  readonly x?: number;
  readonly y?: number;
  readonly time?: number;
  readonly prevented?: boolean;
}

const markup = `<!doctype html>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    #hit, #confirmation { position: absolute; inset: 80px auto auto 80px; width: 200px; height: 100px; }
    #cancel { width: 100%; height: 100%; }
  </style>
  <main id="root">
    <section id="panel" tabindex="-1">
      <button id="opener">Open confirmation</button>
      <button id="next">Next</button>
      <div id="hit"></div>
    </section>
    <section id="confirmation" role="dialog" hidden>
      <button id="cancel"><span id="label">Cancel</span></button>
    </section>
  </main>`;

assert(existsSync("/.dockerenv"), "Run in the stock Playwright container.");
const held = process.argv.includes("--hold");
const server = await createServer({
  configFile: false,
  envDir: false,
  server: { host: "127.0.0.1", watch: null, ws: false },
});
try {
  await server.listen();
  const origin = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"], channel: "chromium" });
  try {
    const page = await browser.newPage({
      hasTouch: true,
      isMobile: true,
      viewport: { height: 480, width: 360 },
    });
    await page.route(origin, (route) => route.fulfill({ contentType: "text/html", body: markup }));
    await page.goto(origin);
    await page.evaluate(async (held) => {
      const gateModule = "/src/input/modalInput.ts";
      const holdModule = "/src/web/input/dom/holdActions.ts";
      const modalModule = "/src/web/ui/dom/modalLayer.ts";
      const { createModalInputGate } = (await import(
        gateModule
      )) as typeof import("../../src/input/modalInput.ts");
      const { bindHoldActions } = (await import(
        holdModule
      )) as typeof import("../../src/web/input/dom/holdActions.ts");
      const { createModalLayer } = (await import(
        modalModule
      )) as typeof import("../../src/web/ui/dom/modalLayer.ts");
      const root = document.querySelector<HTMLElement>("#root")!;
      const opener = document.querySelector<HTMLButtonElement>("#opener")!;
      const confirmation = document.querySelector<HTMLElement>("#confirmation")!;
      const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
      const modal = createModalLayer(root);
      const gate = createModalInputGate();
      const trace: TraceEntry[] = [];
      Object.assign(window, { holdFocusTrace: trace });
      opener.addEventListener("click", () => {
        const scope = gate.open();
        confirmation.hidden = false;
        const close = modal.open({ focus: cancel, isolation: "dialog" }, confirmation);
        const dismiss = (name: string) => {
          close();
          scope.close();
          confirmation.hidden = true;
          trace.push({ focus: document.activeElement!.id, name });
        };
        const action = {
          activate: () => dismiss("activate"),
          available: () => !confirmation.hidden,
          element: cancel,
          hold: () => dismiss("hold"),
          rule: { holdMs: held ? 180 : 10_000, slopPx: 8 },
        };
        const binding = bindHoldActions(
          {
            activation: "pointer-release",
            guard: { gate: scope },
            pointerTarget: document,
            resolve: (target) => (target === cancel ? action : null),
            resolvePointer: (event) =>
              cancel.contains(document.elementFromPoint(event.clientX, event.clientY))
                ? action
                : null,
          },
          root,
        );
        gate.subscribe(binding.cancel);
      });
      for (const name of ["pointerdown", "pointerup", "mousedown", "click"] as const) {
        document.addEventListener(name, (event) => {
          const capabilities = (
            event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }
          ).sourceCapabilities;
          trace.push({
            focus: document.activeElement!.id,
            name,
            prevented: event.defaultPrevented,
            target: (event.target as Element).id,
            time: event.timeStamp,
            touch: capabilities?.firesTouchEvents,
            trusted: event.isTrusted,
            x: event.clientX,
            y: event.clientY,
          });
          if (name === "pointerup") {
            setTimeout(() => trace.push({ focus: document.activeElement!.id, name: "timer" }), 0);
          }
        });
      }
    }, held);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").getAttribute("id"), "cancel");
    const label = (await page.locator("#label").boundingBox())!;
    const x = Math.floor(label.x + label.width / 2) + 0.75;
    const y = Math.floor(label.y + label.height / 2) + 0.5;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x, y }],
      type: "touchStart",
    });
    await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        }),
    );
    if (held) {
      await page.waitForFunction(() =>
        (Reflect.get(window, "holdFocusTrace") as TraceEntry[]).some(({ name }) => name === "hold"),
      );
      assert.equal(await page.locator(":focus").getAttribute("id"), "opener");
    }
    await session.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
    const afterTouch = await page.locator(":focus").getAttribute("id");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
    );
    const readTrace = () =>
      page.evaluate(() => Reflect.get(window, "holdFocusTrace") as TraceEntry[]);
    const touchTrace = await readTrace();
    await page.keyboard.press("Tab");
    const afterTab = await page.locator(":focus").getAttribute("id");
    await page.mouse.click(x, y);
    const afterMouse = await page.locator(":focus").getAttribute("id");
    const mouseTrace = (await readTrace()).slice(touchTrace.length);
    console.log(
      JSON.stringify({
        afterMouse,
        afterTab,
        afterTouch,
        browser: browser.version(),
        held,
        mouseTrace,
        touchTrace,
      }),
    );

    const actions = touchTrace.filter(({ name }) => name === "activate" || name === "hold");
    assert.deepEqual(actions, [{ focus: "opener", name: held ? "hold" : "activate" }]);
    const down = touchTrace.find(({ name }) => name === "mousedown");
    assert(down?.trusted && down.touch && down.target === "hit" && down.focus === "opener");
    const start = touchTrace.find(({ name }) => name === "pointerdown");
    assert(start?.trusted && !start.prevented && start.target === "label");
    const release = touchTrace.find(({ name }) => name === "pointerup");
    assert(release?.trusted && !release.prevented && release.target === "label");
    assert(start.time! < release.time!);
    assert.equal(down.time, release.time);
    assert.equal(down.x, Math.round(release.x!));
    assert.equal(down.y, Math.round(release.y!));
    if (held) {
      assert(touchTrace.indexOf(actions[0]!) < touchTrace.indexOf(release));
    } else {
      assert(touchTrace.indexOf(down) < touchTrace.findIndex(({ name }) => name === "timer"));
    }
    const mouse = mouseTrace.find(({ name }) => name === "mousedown");
    assert(mouse?.trusted && !mouse.touch && !mouse.prevented && mouse.target === "hit");
    assert.equal(afterMouse, "panel");
    assert.equal(afterTouch, "opener", "Retargeted touch mousedown displaced the restored opener");
    assert.equal(down.prevented, true);
    assert.equal(afterTab, "next");
    const click = touchTrace.find((entry) => entry.name === "click" && entry.touch);
    assert(click?.trusted && !click.prevented && click.target === "hit");
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
