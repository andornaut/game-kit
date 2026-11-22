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
    <div id="actions"></div>
    <div><section id="dialog" role="dialog" hidden></section></div>
  </main>`;
const theme = `
  body { background: #3e352b; color: #f1dba7; padding: 16px; }
  #root { --ui-unit: 1.5; --ui-button-gap: 12px; --ui-button-height: 32; --ui-button-min-width: 72;
    --ui-button-padding-x: 8; --ui-button-padding-y: 4;
    --ui-button-focus-fill: #f1dba7; --ui-button-focus-text: #3e352b; }
  #root > div:first-child { display: flex; gap: var(--ui-button-gap); }
  .ui-control-button { color: #f1dba7; background: #54442c; border: 3px solid #211b14;
    box-shadow: inset 0 -4px #35291a; }
  .ui-control-button:active { box-shadow: inset 0 4px #35291a; }
  .ui-control-button[aria-pressed=true] { background: #46645b; --ui-button-focus-fill: #a6c9b9; }
  .ui-control-button:disabled { opacity: .55; }
  .fixture-face-button { background: transparent; border: 0; padding: 0; }
  #selected svg { display: block; }
`;
const csp = "default-src 'self'; style-src 'self'; style-src-attr 'none'";
const hostCss = `
  body { margin: 0; }
  main { display: grid; height: 100dvh; place-items: center; }
  button { width: 1px !important; font-size: 1px !important;
  pointer-events: none !important; } button:focus-visible { outline: none !important; }`;

function control(locator: Locator) {
  return locator.evaluate((element) => {
    const { height, width, x, y } = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const face = element.querySelector(":scope > .ui-button-face");
    const icon = (face ?? element).querySelector(':scope > [aria-hidden="true"]');
    return {
      active: element.matches(":active"),
      all: (element as HTMLElement).style.getPropertyPriority("all"),
      background: css.backgroundColor,
      border: css.border,
      colour: css.color,
      decoration: css.textDecorationLine,
      faceFill: face ? getComputedStyle(face).backgroundColor : css.backgroundColor,
      focus: element.matches(":focus"),
      focusVisible: element.matches(":focus-visible"),
      font: css.fontSize,
      forcedAdjustment: (face ? getComputedStyle(face) : css).forcedColorAdjust,
      geometry: [x, y, width, height],
      iconOpacity: icon ? getComputedStyle(icon).opacity : null,
      opacity: css.opacity,
      outline: { colour: css.outlineColor, style: css.outlineStyle, width: css.outlineWidth },
      pointerEvents: css.pointerEvents,
      selected: element.getAttribute("aria-pressed") === "true",
      shadow: css.boxShadow,
    };
  });
}

function retryWidth(locator: Locator) {
  return locator.evaluate((button) => {
    const panel = button.parentElement!;
    const css = getComputedStyle(button);
    const panelCss = getComputedStyle(panel);
    const range = document.createRange();
    range.selectNodeContents(button);
    const { height, width, x } = button.getBoundingClientRect();
    return {
      buttonCentre: x + width / 2,
      edges: ["padding-left", "padding-right", "border-left-width", "border-right-width"].reduce(
        (total, property) => total + Number.parseFloat(css.getPropertyValue(property)),
        0,
      ),
      font: css.font,
      height,
      labelWidth: range.getBoundingClientRect().width,
      panelCentre: panel.getBoundingClientRect().x + panel.clientLeft + panel.clientWidth / 2,
      panelContentWidth:
        panel.clientWidth -
        Number.parseFloat(panelCss.paddingLeft) -
        Number.parseFloat(panelCss.paddingRight),
      panelHeight: panel.getBoundingClientRect().height,
      scrollable: panel.scrollHeight > panel.clientHeight,
      width,
    };
  });
}

const save = (page: Page, name: string) =>
  existsSync("/outputs") ? page.screenshot({ path: join("/outputs", `${name}.png`) }) : undefined;
const nextPaint = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      }),
  );
const systemColour = (page: Page, name: string) =>
  page.evaluate((name) => {
    const sample = document.createElement("span");
    sample.style.color = name;
    document.body.append(sample);
    const colour = getComputedStyle(sample).color;
    sample.remove();
    return colour;
  }, name);

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
    const page = await browser.newPage({ hasTouch: true, viewport: { height: 520, width: 620 } });
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
      const buttonPath = "/src/web/ui/dom/button.ts";
      const { createButton } = (await import(
        buttonPath
      )) as typeof import("../../src/web/ui/dom/button.ts");
      const holdPath = "/src/web/input/dom/holdActions.ts";
      const { bindHoldActions } = (await import(
        holdPath
      )) as typeof import("../../src/web/input/dom/holdActions.ts");
      const gatePath = "/src/input/modalInput.ts";
      const { createModalInputGate } = (await import(
        gatePath
      )) as typeof import("../../src/input/modalInput.ts");
      const root = document.querySelector<HTMLElement>("#root")!;
      const dialog = document.querySelector<HTMLElement>("#dialog")!;
      const actions = document.querySelector<HTMLElement>("#actions")!;
      const modal = createModalLayer(root);
      const views = new Map<Element, ReturnType<typeof createButton>>();
      const add = (
        parent: HTMLElement,
        id: string,
        options: Parameters<typeof createButton>[1],
      ) => {
        const view = createButton(document, options);
        view.element.id = id;
        parent.append(view.element);
        views.set(view.element, view);
        return view.element;
      };
      const rule = { holdMs: 180, slopPx: 8 };
      let dismiss: () => void;
      const cancel = add(dialog, "cancel", {
        appearance: { className: "fixture-face-button", face: {} },
        content: { kind: "text", label: "Cancel" },
        getAction: () => ({ activate: () => dismiss() }),
        rule,
      });
      const open = () => {
        dialog.hidden = false;
        const close = modal.open(
          { close: () => dismiss(), focus: cancel, isolation: "dialog" },
          dialog,
        );
        dismiss = () => {
          close();
          dialog.hidden = true;
        };
      };
      add(actions, "opener", {
        content: { kind: "text", label: "Open" },
        getAction: () => ({ activate: open }),
        rule,
      });
      let activations = 0;
      const svg = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(svg, "svg");
      icon.setAttribute("width", "72");
      icon.setAttribute("height", "32");
      const faceArt = document.createElementNS(svg, "path");
      faceArt.setAttribute("fill", "#18374d");
      faceArt.setAttribute("d", "M0 0h72v32H0z");
      const mark = document.createElementNS(svg, "path");
      mark.setAttribute("fill", "#f1dba7");
      mark.setAttribute("d", "M28 15h16v3H28z M34 9h4v15h-4z");
      icon.append(faceArt, mark);
      add(actions, "selected", {
        content: { icon, kind: "icon", name: "Selected" },
        getAction: () => ({
          activate: () => {
            root.dataset.activations = String(++activations);
          },
        }),
        getState: () => ({ selected: true, toggled: true }),
        rule,
      });
      add(actions, "disabled", {
        content: { kind: "text", label: "Disabled" },
        getAction: () => ({
          activate: () => {
            throw new Error("Disabled button activated");
          },
        }),
        getState: () => ({ availability: { kind: "disabled" } }),
        rule,
      });
      bindHoldActions(
        {
          guard: { gate: createModalInputGate() },
          resolve: (target) => {
            const button = target instanceof Element ? target.closest("button") : null;
            return button === null ? null : (views.get(button)?.holdAction() ?? null);
          },
        },
        root,
      );
    });
    const opener = page.locator("#opener");
    const cancel = page.locator("#cancel");
    const iconButton = page.getByRole("button", { name: "Selected" });
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
    const selectedFocused = await control(iconButton);
    await save(page, "shared-selected-icon-focus");
    await page.emulateMedia({ forcedColors: "active" });
    const forcedIcon = await control(iconButton);
    const highlight = await systemColour(page, "Highlight");
    const highlightText = await systemColour(page, "HighlightText");
    await save(page, "shared-selected-icon-forced-colours");
    await page.emulateMedia({ forcedColors: "none" });
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
    await save(page, "shared-forced-colours");
    await page.emulateMedia({ forcedColors: "none" });

    const point = (await iconButton.boundingBox())!;
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    const root = page.locator("#root");
    await page.touchscreen.tap(x, y);
    assert.equal(await root.getAttribute("data-activations"), "1");
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { touchPoints: [{ x, y }], type: "touchStart" });
    await page.waitForFunction(
      () => document.querySelector("#root")?.getAttribute("data-activations") === "2",
    );
    await touch.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
    await nextPaint(page);
    assert.equal(await root.getAttribute("data-activations"), "2");
    await page.keyboard.press("ArrowRight");

    await page.evaluate(async () => {
      const path = "/src/web/crash/dom/crashScreen.ts";
      const { installCrashScreen } = (await import(
        path
      )) as typeof import("../../src/web/crash/dom/crashScreen.ts");
      installCrashScreen(
        {
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
        },
        window,
      );
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("Fixture crash") }));
    });
    const reload = page.getByRole("button", { name: "Reload" });
    const summary = page.locator(".crash-details summary");
    const crashButton = await control(reload);
    await save(page, "crash-keyboard-button");
    await page.keyboard.press("Shift+Tab");
    const crashSummary = await control(summary);
    const crashIdle = await control(reload);
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
    await save(page, "crash-button-forced-colours");
    await page.keyboard.press("Shift+Tab");
    const forcedSummary = await control(summary);
    await save(page, "crash-forced-colours");
    await page.emulateMedia({ forcedColors: "none" });

    const mountRetry = (mode: "numeric" | "content" | "default" | "unsupported" = "numeric") =>
      page.evaluate(async (mode) => {
        const path = "/src/web/progress/dom/loadingFailure.ts";
        const { mountLoadingFailure } = (await import(
          path
        )) as typeof import("../../src/web/progress/dom/loadingFailure.ts");
        const parent = document.querySelector("main")!;
        const supports = CSS.supports.bind(CSS);
        if (mode === "unsupported") {
          CSS.supports = (condition) =>
            condition === "selector(:focus-visible)" ? false : supports(condition);
        }
        const onRetry = () => {
          parent.dataset.retried = "yes";
        };
        const presentation = {
          action: {
            borderWidthPx: 3,
            heightPx: 48,
            highlightHeightPx: 1,
            paddingBottomPx: 4,
            paddingXPx: 12,
            shadeHeightPx: 4,
            widthPx: mode === "content" ? ("content" as const) : 128,
          },
          palette: {
            action: "#54442c",
            actionText: "#f1dba7",
            border: "#211b14",
            highlight: "#75603c",
            lip: "#35291a",
            panel: "#3e352b",
            shade: "#35291a",
            shadow: "#211b14",
            text: "#f1dba7",
          },
          panel: {
            bodyActionGapPx: 20,
            borderWidthPx: 2,
            lipHeightPx: 4,
            maxWidthPx: 328,
            paddingBottomPx: 16,
            paddingTopPx: 24,
            paddingXPx: 16,
            safeInsetPx: 12,
            shadowOffsetPx: 4,
            titleBodyGapPx: 12,
          },
          text: {
            action: { lineHeight: 1.25, sizePx: 16, weight: 700 },
            body: { lineHeight: 1.4, sizePx: 16, weight: 400 },
            title: { lineHeight: 1.25, sizePx: 20, weight: 700 },
          },
        };
        const themed =
          mode === "content" || mode === "numeric"
            ? mountLoadingFailure({ onRetry, presentation }, parent)
            : undefined;
        const view = themed ?? mountLoadingFailure({ onRetry }, parent);
        CSS.supports = supports;
        view.update({ attempt: 1, error: new Error("Fixture failure"), kind: "failed" });
        const modalPath = "/src/web/ui/dom/modalLayer.ts";
        const { createModalLayer } = (await import(
          modalPath
        )) as typeof import("../../src/web/ui/dom/modalLayer.ts");
        const modal = createModalLayer(parent);
        const retry = view.element.querySelector("button")!;
        let reset = retry.style.cssText;
        parent.addEventListener("fixture-palette", () => {
          themed?.setPresentation({
            ...presentation,
            palette: { ...presentation.palette, action: "#46645b", actionText: "#e9f4ed" },
          });
        });
        parent.addEventListener("fixture-open", () => {
          const dialog = document.createElement("section");
          parent.append(dialog);
          const close = modal.open(
            {
              close: () => {
                close();
                dialog.remove();
              },
              isolation: "dialog",
            },
            dialog,
          );
          reset = retry.style.cssText;
        });
        parent.addEventListener("fixture-dispose", () => {
          view.dispose();
          modal.dispose();
          parent.dataset.cleaned = JSON.stringify({
            connected: retry.isConnected,
            reset: retry.style.cssText === reset,
          });
        });
      }, mode);
    await page.goto(`${origin}emergency`);
    await mountRetry();
    const retry = page.getByRole("button", { name: "Retry" });
    const numeric = await retryWidth(retry);
    assert.equal(numeric.width, 128);
    const pressRetry = async (capture?: string) => {
      const box = (await retry.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await nextPaint(page);
      const down = await control(retry);
      if (capture !== undefined) {
        await save(page, capture);
      }
      await page.mouse.move(1, 1);
      await page.mouse.up();
      await nextPaint(page);
      return down;
    };
    const checkPointerPress = async (capture: string) => {
      const down = await pressRetry(capture);
      const up = await control(retry);
      assert(up.focus && !up.focusVisible && up.outline.style === "none");
      assert(down.active && !down.focusVisible && !up.active);
      assert.notEqual(down.background, up.background);
      assert.equal(down.background, up.colour);
      assert.equal(down.colour, up.background);
      assert.equal(down.decoration, "underline");
      assert.equal(up.decoration, "none");
      assert.equal(down.outline.style, "none");
      assert.equal(down.border, up.border);
      assert.equal(down.shadow, up.shadow);
      assert.deepEqual(down.geometry, up.geometry);
      assert.equal(await page.locator("main").getAttribute("data-retried"), null);
      return { down, up };
    };
    const { down: retryPressed, up: retryPointer } = await checkPointerPress(
      "emergency-pointer-pressed",
    );
    await save(page, "emergency-pointer");
    await page.keyboard.press("ArrowRight");
    await nextPaint(page);
    const fallback = await control(retry);
    await save(page, "emergency-keyboard");
    await pressRetry();
    const retryStablePointer = await control(retry);
    assert(retryStablePointer.focus);
    assert.equal(retryStablePointer.outline.style, "none");
    assert.equal(
      retryStablePointer.background,
      retryStablePointer.focusVisible ? fallback.background : retryPointer.background,
    );
    await page.locator("main").dispatchEvent("fixture-palette");
    await page.locator("main").dispatchEvent("fixture-open");
    const retryUpdated = await control(page.locator(".loading-failure button"));
    assert.equal(retryUpdated.background, "rgb(70, 100, 91)");
    assert.equal(retryUpdated.colour, "rgb(233, 244, 237)");
    await page.keyboard.press("Escape");
    await nextPaint(page);
    const retryReturn = await control(retry);
    assert(retryReturn.focus && retryReturn.focusVisible);
    assert.equal(retryReturn.background, retryUpdated.colour);
    assert.equal(retryReturn.colour, retryUpdated.background);
    await page.emulateMedia({ forcedColors: "active" });
    await nextPaint(page);
    const forcedFallback = await control(retry);
    await save(page, "emergency-forced-colours");
    await page.keyboard.down("Space");
    await nextPaint(page);
    const forcedPressed = await control(retry);
    assert(forcedPressed.active && forcedPressed.focusVisible);
    assert.equal(forcedPressed.background, highlightText);
    assert.equal(forcedPressed.colour, highlight);
    assert.equal(forcedPressed.outline.style, "none");
    assert.equal(forcedPressed.border, forcedFallback.border);
    assert.deepEqual(forcedPressed.geometry, forcedFallback.geometry);
    await save(page, "emergency-forced-pressed");
    await page.keyboard.up("Space");
    await nextPaint(page);
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");
    assert.equal((await control(retry)).active, false);
    await page.locator("main").evaluate((element) => element.removeAttribute("data-retried"));
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");
    await page.locator("main").evaluate((element) => element.removeAttribute("data-retried"));
    await retry.click();
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");
    await page.keyboard.press("ArrowRight");
    await retry.focus();
    await nextPaint(page);
    assert.equal((await control(retry)).background, highlight);
    await page.locator("main").dispatchEvent("fixture-dispose");
    await nextPaint(page);
    assert.equal(
      await page.locator("main").getAttribute("data-cleaned"),
      '{"connected":false,"reset":true}',
    );
    await page.emulateMedia({ forcedColors: "none" });
    await page.goto(`${origin}emergency`);
    await mountRetry("default");
    const unconfigured = await retryWidth(retry);
    await page.goto(`${origin}emergency`);
    await mountRetry("unsupported");
    await page.keyboard.press("Tab");
    const unsupported = await control(retry);
    assert(unsupported.focus && unsupported.focusVisible && unsupported.outline.style === "auto");
    await save(page, "emergency-native-fallback");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");
    assert.deepEqual(await retryWidth(retry), unconfigured);

    await page.setViewportSize({ height: 720, width: 1280 });
    await page.goto(`${origin}emergency`);
    await mountRetry("content");
    const contentDesktopPress = await checkPointerPress("emergency-content-desktop-pressed");
    await page.keyboard.press("ArrowRight");
    await nextPaint(page);
    const contentWidth = await retryWidth(retry);
    assert(Math.abs(contentWidth.width - contentWidth.labelWidth - contentWidth.edges) < 0.5);
    assert(Math.abs(contentWidth.buttonCentre - contentWidth.panelCentre) < 1);
    assert.equal(contentWidth.height, numeric.height);
    assert.equal(contentWidth.font, numeric.font);
    const contentFocus = await control(retry);
    assert(contentFocus.focusVisible && contentFocus.outline.style === "none");
    await save(page, "emergency-content-width");

    await page.setViewportSize({ height: 360, width: 720 });
    await page.mouse.click(1, 1);
    const contentCompactPress = await checkPointerPress("emergency-content-compact-pressed");

    await page.setViewportSize({ height: 100, width: 620 });
    const short = await retryWidth(retry);
    assert(short.scrollable);
    assert(short.panelHeight <= 100 - 24);
    assert.equal(short.width, contentWidth.width);
    assert.equal(short.height, numeric.height);
    assert.equal(short.font, numeric.font);
    await retry.scrollIntoViewIfNeeded();
    await save(page, "emergency-content-short");

    await page.setViewportSize({ height: 100, width: 116 });
    const narrow = await retryWidth(retry);
    assert(narrow.scrollable);
    assert(narrow.width < contentWidth.width);
    assert.equal(narrow.width, narrow.panelContentWidth);
    assert(Math.abs(narrow.buttonCentre - narrow.panelCentre) < 1);
    assert.equal(narrow.height, numeric.height);
    assert.equal(narrow.font, numeric.font);
    await retry.scrollIntoViewIfNeeded();
    await save(page, "emergency-content-narrow");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("main").getAttribute("data-retried"), "yes");

    console.log(
      JSON.stringify({
        browser: browser.version(),
        ordinary,
        selected,
        selectedFocused,
        forcedIcon,
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
        retryPointer,
        retryPressed,
        retryStablePointer,
        retryReturn,
        forcedCrashButton,
        forcedSummary,
        fallback,
        forcedFallback,
        forcedPressed,
        numeric,
        unconfigured,
        contentWidth,
        contentDesktopPress,
        contentCompactPress,
        short,
        narrow,
        unsupported,
      }),
    );
    for (const entry of [fallback, forcedFallback]) {
      assert(entry.focus && entry.focusVisible);
      assert.equal(entry.all, "important");
      assert.equal(entry.pointerEvents, "auto");
      assert.notEqual(entry.font, "1px");
      assert.notEqual(entry.geometry[2], 1);
      assert.equal(entry.outline.style, "none");
    }
    assert.equal(fallback.background, retryPointer.colour);
    assert.equal(fallback.colour, retryPointer.background);
    assert.deepEqual(fallback.geometry, retryPointer.geometry);
    assert.equal(fallback.border, retryPointer.border);
    assert.equal(fallback.shadow, retryPointer.shadow);
    for (const entry of [pointerCancel, pointerReturn, pointerSummary]) {
      assert(entry.focus && !entry.focusVisible);
      assert.equal(entry.outline.style, "none");
    }
    for (const entry of [keyboardCancel, keyboardReturn, pressed, crashButton, selectedFocused]) {
      assert(entry.focus && entry.focusVisible);
      assert.equal(entry.outline.style, "none");
    }
    assert.equal(keyboardCancel.background, pointerCancel.background);
    assert.notEqual(keyboardCancel.faceFill, pointerCancel.faceFill);
    assert.equal(keyboardReturn.background, "rgb(241, 219, 167)");
    assert.equal(keyboardReturn.colour, "rgb(62, 53, 43)");
    assert.equal(crashButton.background, "rgb(62, 53, 43)");
    assert.equal(crashButton.colour, "rgb(237, 183, 99)");
    assert.deepEqual(crashButton.geometry, crashIdle.geometry);
    assert.equal(crashButton.border, crashIdle.border);
    assert.equal(crashButton.shadow, crashIdle.shadow);
    assert.equal(crashSummary.outline.style, "double");
    assert.equal(crashSummary.outline.colour, "rgb(237, 183, 99)");
    for (const entry of [pressed, keyboardReturn, pointerReturn]) {
      assert.deepEqual(entry.geometry, ordinary.geometry);
      assert.equal(entry.border, ordinary.border);
    }
    assert(pressed.active && pressed.shadow !== ordinary.shadow);
    assert.equal(keyboardReturn.shadow, ordinary.shadow);
    assert.notEqual(selected.background, ordinary.background);
    assert(selectedFocused.selected && forcedIcon.selected);
    assert.equal(selectedFocused.background, "rgb(166, 201, 185)");
    assert.deepEqual(selectedFocused.geometry, selected.geometry);
    assert.equal(selectedFocused.border, selected.border);
    assert.equal(selectedFocused.shadow, selected.shadow);
    assert.equal(selected.iconOpacity, "1");
    assert.equal(selectedFocused.iconOpacity, "0.65");
    assert.equal(forcedIcon.iconOpacity, "0.65");
    assert.notEqual(disabled.opacity, ordinary.opacity);
    assert.deepEqual(crashSummary.geometry, pointerSummary.geometry);
    for (const entry of [forcedShared, forcedCrashButton, forcedFallback, forcedIcon]) {
      assert(entry.focus && entry.focusVisible);
      assert.equal(entry.outline.style, "none");
      assert.equal(entry.forcedAdjustment, "none");
      assert.equal(entry.background, highlight);
      assert.equal(entry.colour, highlightText);
    }
    assert.deepEqual(forcedSummary.outline, { colour: highlight, style: "solid", width: "2px" });
    assert.deepEqual(forcedShared.geometry, ordinary.geometry);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
