// Run node tests/e2e/keyboard-focus-style.ts in the stock Playwright container.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Locator, type Page } from "playwright-core";
import { createServer } from "vite";

const markup = `<!doctype html>
  <link rel="stylesheet" href="/src/web/ui/dom/controls.css?direct">
  <link rel="stylesheet" href="/src/web/crash/dom/crash.css?direct">
  <link rel="stylesheet" href="/theme.css">
  <main id="root">
    <div>
      <button id="opener" class="ui-control-button"><span class="ui-control-label">Open</span></button>
      <button id="selected" class="ui-control-button" aria-pressed="true">Selected</button>
      <button id="disabled" class="ui-control-button" disabled>Disabled</button>
    </div>
    <div><section id="dialog" role="dialog" hidden>
      <button id="cancel" class="ui-control-button">Cancel</button>
    </section></div>
  </main>`;
const theme = `
  body { background: #3e352b; color: #f1dba7; padding: 16px; }
  #root { --ui-unit: 1.5; --ui-button-gap: 12px; --ui-button-height: 32; --ui-button-min-width: 72;
    --ui-button-padding-x: 8; --ui-button-padding-y: 4; }
  #root > div:first-child { display: flex; gap: var(--ui-button-gap); }
  .ui-control-button { color: #f1dba7; background: #54442c; border: 3px solid #211b14;
    box-shadow: inset 0 -4px #35291a; }
  .ui-control-button:active { box-shadow: inset 0 4px #35291a; }
  .ui-control-button[aria-pressed=true] { background: #46645b; }
  .ui-control-button:disabled { opacity: .55; }
`;
const csp = "default-src 'self'; style-src 'self'; style-src-attr 'none'";
const hostCss = `button { width: 1px !important; font-size: 1px !important;
  pointer-events: none !important; } button:focus-visible { outline: none !important; }`;

function control(locator: Locator) {
  return locator.evaluate((element) => {
    const { height, width, x, y } = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return {
      active: element.matches(":active"),
      all: (element as HTMLElement).style.getPropertyPriority("all"),
      background: css.backgroundColor,
      border: css.border,
      colour: css.color,
      focus: element.matches(":focus"),
      focusVisible: element.matches(":focus-visible"),
      font: css.fontSize,
      geometry: [x, y, width, height],
      opacity: css.opacity,
      outline: { colour: css.outlineColor, style: css.outlineStyle, width: css.outlineWidth },
      pointerEvents: css.pointerEvents,
      shadow: css.boxShadow,
    };
  });
}

const save = (page: Page, name: string) =>
  existsSync("/outputs") ? page.screenshot({ path: join("/outputs", `${name}.png`) }) : undefined;
const systemHighlight = (page: Page) =>
  page.evaluate(() => {
    const sample = document.createElement("span");
    sample.style.color = "Highlight";
    document.body.append(sample);
    const colour = getComputedStyle(sample).color;
    sample.remove();
    return colour;
  });

assert(existsSync("/.dockerenv"), "Run in the stock Playwright container.");
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
    const page = await browser.newPage({ viewport: { height: 520, width: 620 } });
    await page.route(origin, (route) =>
      route.fulfill({
        body: markup,
        contentType: "text/html",
        headers: { "Content-Security-Policy": csp },
      }),
    );
    await page.route(`${origin}theme.css`, (route) =>
      route.fulfill({ body: theme, contentType: "text/css" }),
    );
    await page.route(`${origin}emergency`, (route) =>
      route.fulfill({
        body: '<!doctype html><link rel="stylesheet" href="/host.css"><main></main>',
        contentType: "text/html",
        headers: { "Content-Security-Policy": csp },
      }),
    );
    await page.route(`${origin}host.css`, (route) =>
      route.fulfill({ body: hostCss, contentType: "text/css" }),
    );
    await page.goto(origin);
    await page.evaluate(async () => {
      const path = "/src/web/ui/dom/modalLayer.ts";
      const { createModalLayer } = (await import(
        path
      )) as typeof import("../../src/web/ui/dom/modalLayer.ts");
      const root = document.querySelector<HTMLElement>("#root")!;
      const dialog = document.querySelector<HTMLElement>("#dialog")!;
      const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
      const modal = createModalLayer(root);
      let dismiss: () => void;
      root.querySelector("#opener")!.addEventListener("click", () => {
        dialog.hidden = false;
        const close = modal.open(
          { close: () => dismiss(), focus: cancel, isolation: "dialog" },
          dialog,
        );
        dismiss = () => {
          close();
          dialog.hidden = true;
        };
      });
      cancel.addEventListener("click", () => dismiss());
    });
    const opener = page.locator("#opener");
    const cancel = page.locator("#cancel");
    const ordinary = await control(opener);
    const selected = await control(page.locator("#selected"));
    const disabled = await control(page.locator("#disabled"));
    await opener.click();
    const pointerCancel = await control(cancel);
    await cancel.click();
    const pointerReturn = await control(opener);
    await save(page, "shared-pointer-return");

    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("id"), "selected");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator("#disabled").evaluate((element) => element.matches(":focus")),
      false,
    );
    await page.keyboard.press("Tab");
    await page.keyboard.down("Space");
    const pressed = await control(opener);
    await page.keyboard.up("Space");
    const keyboardCancel = await control(cancel);
    await page.keyboard.press("Escape");
    const keyboardReturn = await control(opener);
    await save(page, "shared-keyboard-return");
    await page.emulateMedia({ forcedColors: "active" });
    const forcedShared = await control(opener);
    const highlight = await systemHighlight(page);
    await save(page, "shared-forced-colours");
    await page.emulateMedia({ forcedColors: "none" });

    await page.evaluate(async () => {
      const path = "/src/web/crash/dom/crashScreen.ts";
      const { installCrashScreen } = (await import(
        path
      )) as typeof import("../../src/web/crash/dom/crashScreen.ts");
      installCrashScreen(window, {
        buildLabel: "Focus fixture",
        colours: {
          background: "#3e352b",
          buttonFace: "#edb763",
          buttonLip: "#ad7c3c",
          ink: "#211b14",
          text: "#f1dba7",
        },
        dev: true,
        words: { body: "An error interrupted play.", reload: "Reload", title: "Play interrupted" },
      });
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("Fixture crash") }));
    });
    const reload = page.getByRole("button", { name: "Reload" });
    const summary = page.locator(".crash-details summary");
    const crashButton = await control(reload);
    await save(page, "crash-keyboard-button");
    await page.keyboard.press("Shift+Tab");
    const crashSummary = await control(summary);
    await save(page, "crash-keyboard-summary");
    await page.keyboard.press("Space");
    assert.equal(await page.locator(".crash-details").getAttribute("open"), "");
    await page.keyboard.press("Tab");
    assert((await control(page.getByRole("button", { name: "Copy" }))).focus);
    await summary.click();
    const pointerSummary = await control(summary);
    assert.equal(await page.locator(".crash-details").getAttribute("open"), null);
    await page.emulateMedia({ forcedColors: "active" });
    await page.keyboard.press("Tab");
    const forcedCrashButton = await control(reload);
    await page.keyboard.press("Shift+Tab");
    const forcedSummary = await control(summary);
    await save(page, "crash-forced-colours");
    await page.emulateMedia({ forcedColors: "none" });

    await page.goto(`${origin}emergency`);
    await page.evaluate(async () => {
      const path = "/src/web/progress/dom/loadingFailure.ts";
      const { mountLoadingFailure } = (await import(
        path
      )) as typeof import("../../src/web/progress/dom/loadingFailure.ts");
      const parent = document.querySelector("main")!;
      const view = mountLoadingFailure(
        {
          onRetry: () => {
            parent.dataset.retried = "yes";
          },
        },
        parent,
      );
      view.update({ attempt: 1, error: new Error("Fixture failure"), kind: "failed" });
    });
    const retry = page.getByRole("button", { name: "Retry" });
    await page.keyboard.press("Tab");
    const fallback = await control(retry);
    await save(page, "emergency-keyboard");
    await page.emulateMedia({ forcedColors: "active" });
    const forcedFallback = await control(retry);
    await save(page, "emergency-forced-colours");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");
    await page.locator("main").evaluate((element) => element.removeAttribute("data-retried"));
    await retry.click();
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");

    console.log(
      JSON.stringify({
        browser: browser.version(),
        ordinary,
        selected,
        disabled,
        pointerCancel,
        pointerReturn,
        pressed,
        keyboardCancel,
        keyboardReturn,
        forcedShared,
        crashButton,
        crashSummary,
        pointerSummary,
        forcedCrashButton,
        forcedSummary,
        fallback,
        forcedFallback,
      }),
    );
    for (const entry of [fallback, forcedFallback]) {
      assert(entry.focus && entry.focusVisible);
      assert.equal(entry.all, "important");
      assert.equal(entry.pointerEvents, "auto");
      assert.notEqual(entry.font, "1px");
      assert.notEqual(entry.geometry[2], 1);
      assert.notEqual(entry.outline.style, "none");
    }
    for (const entry of [pointerCancel, pointerReturn, pointerSummary]) {
      assert(entry.focus && !entry.focusVisible);
      assert.equal(entry.outline.style, "none");
    }
    for (const entry of [keyboardCancel, keyboardReturn, crashButton, crashSummary]) {
      assert(entry.focus && entry.focusVisible);
      assert.equal(entry.outline.style, "double");
    }
    assert.equal(keyboardReturn.outline.colour, ordinary.colour);
    assert(Number.parseFloat(keyboardReturn.outline.width) > 3);
    assert.equal(crashButton.outline.colour, "rgb(241, 219, 167)");
    assert.equal(crashSummary.outline.colour, "rgb(237, 183, 99)");
    for (const entry of [pressed, keyboardReturn, pointerReturn]) {
      assert.deepEqual(entry.geometry, ordinary.geometry);
      assert.equal(entry.border, ordinary.border);
    }
    assert(pressed.active && pressed.shadow !== ordinary.shadow);
    assert.equal(keyboardReturn.shadow, ordinary.shadow);
    assert.notEqual(selected.background, ordinary.background);
    assert.notEqual(disabled.opacity, ordinary.opacity);
    assert.deepEqual(crashSummary.geometry, pointerSummary.geometry);
    for (const entry of [forcedShared, forcedCrashButton, forcedSummary]) {
      assert(entry.focus && entry.focusVisible);
      assert.deepEqual(entry.outline, { colour: highlight, style: "solid", width: "2px" });
    }
    assert.deepEqual(forcedShared.geometry, ordinary.geometry);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
