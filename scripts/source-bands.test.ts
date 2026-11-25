// CLEANUP (added 2026-11-25): remove once the known-violations table is empty and ESLint guards the bands.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { SOURCE_BANDS, sourceBandProblems, type SourceBands } from "./source-bands.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The violations the migration has yet to fix. Remove each entry as it is fixed: the tree must
// report exactly these, so the table only shrinks.
const KNOWN_VIOLATIONS: readonly string[] = [
  "non-entry import: src/achievements.ts -> src/save/saveStore.ts",
  "non-entry import: src/achievements.ts -> src/save/storage.ts",
  "non-entry import: src/achievements.ts -> src/save/versionedSave.ts",
  "non-entry import: src/clock/phaser/capFrameRate.ts -> src/clock/frameCap.ts",
  "non-entry import: src/input/phaser/catchOutsideTaps.ts -> src/input/outsideTap.ts",
  "non-entry import: src/input/phaser/guardSceneInput.ts -> src/input/tapGuard.ts",
  "non-entry import: src/load/phaser/watchLoader.ts -> src/clock/timer.ts",
  "non-entry import: src/load/phaser/watchLoader.ts -> src/load/fileShare.ts",
  "non-entry import: src/load/phaser/watchLoader.ts -> src/load/loaderConfig.ts",
  "non-entry import: src/progressState.ts -> src/clock/timer.ts",
  "non-entry import: src/testing/storageFixture.ts -> src/save/storage.ts",
  "non-entry import: src/text/phaser/phaserBitmapFont.ts -> src/text/bitmapFont.ts",
  "non-entry import: src/text/phaser/registerPixelFont.ts -> src/text/pixelFont.ts",
  "non-entry import: src/view/phaser/uiCommands.ts -> src/art/rgbaImageTypes.ts",
  "non-entry import: src/view/phaser/uiComposite.ts -> src/art/rgbaImageTypes.ts",
  "non-entry import: src/web/crash/dom/crashScreen.ts -> src/web/crash/crashModel.ts",
  "non-entry import: src/web/crash/dom/crashScreen.ts -> src/web/input/dom/holdActions.ts",
  "non-entry import: src/web/crash/dom/crashScreen.ts -> src/web/ui/dom/focusModality.ts",
  "non-entry import: src/web/crash/dom/crashScreen.ts -> src/web/ui/dom/nativeButton.ts",
  "non-entry import: src/web/input/dom/holdActions.ts -> src/input/hold.ts",
  "non-entry import: src/web/input/dom/holdActions.ts -> src/input/tapGuard.ts",
  "non-entry import: src/web/progress/dom/loadingFailure.ts -> src/load/loadingAttempts.ts",
  "non-entry import: src/web/progress/dom/loadingFailure.ts -> src/ui/uiTheme.ts",
  "non-entry import: src/web/progress/dom/loadingFailure.ts -> src/web/input/dom/holdActions.ts",
  "non-entry import: src/web/progress/dom/loadingFailure.ts -> src/web/ui/dom/nativeButton.ts",
  "non-entry import: src/web/progress/dom/retryFocus.ts -> src/ui/uiTheme.ts",
  "non-entry import: src/web/pwa/dom/backNavigation.ts -> src/web/pwa/backNavigation.ts",
  "non-entry import: src/web/pwa/dom/buildArchiveDownload.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/buildArchiveStore.ts -> src/web/pwa/buildArchive.ts",
  "non-entry import: src/web/pwa/dom/buildArchiveStore.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/buildArchiveStore.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/buildGroupStore.ts -> src/web/pwa/buildArchive.ts",
  "non-entry import: src/web/pwa/dom/buildGroupStore.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/buildGroupStore.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/buildInstaller.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/buildInstaller.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/buildInstaller.ts -> src/web/pwa/cachePolicy.ts",
  "non-entry import: src/web/pwa/dom/buildInstaller.ts -> src/web/pwa/verifiedJsonBody.ts",
  "non-entry import: src/web/pwa/dom/buildStore.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/buildStore.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/exitApp.ts -> src/web/pwa/appWindow.ts",
  "non-entry import: src/web/pwa/dom/groupArchiveMemberReader.ts -> src/web/pwa/buildArchive.ts",
  "non-entry import: src/web/pwa/dom/groupArchiveMemberReader.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/groupArchiveMemberReader.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/installButton.ts -> src/web/pwa/installState.ts",
  "non-entry import: src/web/pwa/dom/installFlow.ts -> src/web/pwa/installState.ts",
  "non-entry import: src/web/pwa/dom/launch.ts -> src/web/progress/dom/loadingFailure.ts",
  "non-entry import: src/web/pwa/dom/launch.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/launch.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/launch.ts -> src/web/pwa/launchRules.ts",
  "non-entry import: src/web/pwa/dom/launchGroups.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/launchGroups.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/launchGroups.ts -> src/web/pwa/launchRules.ts",
  "non-entry import: src/web/pwa/dom/originMemberReader.ts -> src/web/pwa/originMemberIndex.ts",
  "non-entry import: src/web/pwa/dom/serviceWorker.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/serviceWorker.ts -> src/web/pwa/buildRecords.ts",
  "non-entry import: src/web/pwa/dom/serviceWorker.ts -> src/web/pwa/cachePolicy.ts",
  "non-entry import: src/web/pwa/dom/serviceWorker.ts -> src/web/pwa/routerRules.ts",
  "non-entry import: src/web/pwa/dom/serviceWorker.ts -> src/web/pwa/verifiedJsonBody.ts",
  "non-entry import: src/web/pwa/dom/updateGroupArchiveReader.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/updateGroupArchiveReader.ts -> src/web/pwa/buildGroupRecipes.ts",
  "non-entry import: src/web/pwa/dom/verifiedJsonSource.ts -> src/web/pwa/buildContract.ts",
  "non-entry import: src/web/pwa/dom/verifiedJsonSource.ts -> src/web/pwa/verifiedJsonBody.ts",
  "non-entry import: src/web/save/dom/localSaveStorage.ts -> src/save/storage.ts",
  "non-entry import: src/web/save/dom/localSaveStorage.ts -> src/web/save/storage.ts",
  "non-entry import: src/web/save/dom/pageSessionStore.ts -> src/web/save/sessionStore.ts",
  "non-entry import: src/web/save/storage.ts -> src/save/storage.ts",
  "non-entry import: src/web/ui/dom/actionGroup.ts -> src/ui/actionGroup.ts",
  "non-entry import: src/web/ui/dom/actionGroup.ts -> src/ui/buttonLayout.ts",
  "non-entry import: src/web/ui/dom/button.ts -> src/input/hold.ts",
  "non-entry import: src/web/ui/dom/button.ts -> src/ui/buttonLayout.ts",
  "non-entry import: src/web/ui/dom/button.ts -> src/ui/controlPresentation.ts",
  "non-entry import: src/web/ui/dom/button.ts -> src/web/input/dom/holdActions.ts",
  "non-entry import: src/web/ui/dom/buttonLayout.ts -> src/ui/buttonLayout.ts",
  "non-entry import: src/web/ui/dom/buttonSkin.ts -> src/art/aseprite.ts",
  "non-entry import: src/web/ui/dom/controlPresentation.ts -> src/ui/controlPresentation.ts",
  "non-entry import: src/web/ui/dom/domPress.ts -> src/input/modalInput.ts",
  "non-entry import: src/web/ui/dom/domPress.ts -> src/input/onePress.ts",
  "non-entry import: src/web/ui/dom/domPress.ts -> src/input/outsideTap.ts",
  "non-entry import: src/web/ui/dom/domPress.ts -> src/input/tapGuard.ts",
  "non-entry import: src/web/ui/dom/formRow.ts -> src/ui/formRow.ts",
  "non-entry import: src/web/ui/dom/hudDisc.ts -> src/ui/hudDisc.ts",
  "non-entry import: src/web/ui/dom/layoutTree.ts -> src/ui/layoutTree.ts",
  "non-entry import: src/web/ui/dom/modalFrame.ts -> src/input/modalInput.ts",
  "non-entry import: src/web/ui/dom/modalFrame.ts -> src/ui/actionGroup.ts",
  "non-entry import: src/web/ui/dom/modalFrame.ts -> src/ui/modalFrame.ts",
  "non-entry import: src/web/ui/dom/modalFrame.ts -> src/ui/uiTheme.ts",
  "non-entry import: src/web/ui/dom/modalLayer.ts -> src/ui/focusKeys.ts",
  "non-entry import: src/web/ui/dom/pager.ts -> src/input/hold.ts",
  "non-entry import: src/web/ui/dom/pager.ts -> src/ui/actionGroup.ts",
  "non-entry import: src/web/ui/dom/pager.ts -> src/ui/pager.ts",
  "non-entry import: src/web/ui/dom/slider.ts -> src/ui/slider.ts",
  "non-entry import: src/web/ui/dom/uiTheme.ts -> src/ui/uiTheme.ts",
  "non-entry import: src/web/view/dom/watchFrameTurn.ts -> src/view/pagePoint.ts",
  "non-entry import: src/web/view/dom/watchFrameTurn.ts -> src/web/view/frameTurn.ts",
  "non-entry import: src/web/view/frameTurn.ts -> src/view/pagePoint.ts",
  "non-entry import: src/web/view/phaser/followFrameTurn.ts -> src/view/fitCheck.ts",
  "non-entry import: src/web/view/phaser/followFrameTurn.ts -> src/view/pagePoint.ts",
  "non-entry import: src/web/view/phaser/followFrameTurn.ts -> src/view/renderScale.ts",
  "non-entry import: src/web/view/phaser/followFrameTurn.ts -> src/view/settleFit.ts",
  "non-entry import: src/web/view/phaser/followFrameTurn.ts -> src/web/view/dom/watchFrameTurn.ts",
  "unplaced: src/web/build/buildLabel.ts",
  "unplaced: src/web/build/buildVersion.ts",
  "unplaced: src/web/build/phaserBuild.ts",
  "unplaced: src/web/build/vite/buildInfo.d.ts",
  "unplaced: src/web/build/vite/contentHash.ts",
  "unplaced: src/web/build/vite/gameConfig.ts",
  "unplaced: src/web/build/vite/gitHead.ts",
  "unplaced: src/web/build/vite/phaserBuildPlugin.ts",
  "unplaced: src/web/build/vite/phaserSource.ts",
  "unplaced: src/web/build/vite/phaserUses.ts",
  "unplaced: src/web/headers/securityHeaders.ts",
  "unplaced: src/web/headers/vite/securityHeadersPlugin.ts",
  "unplaced: src/web/mapLimit.ts",
  "unplaced: src/web/pwa/vite/buildArchiveFiles.ts",
  "unplaced: src/web/pwa/vite/classicWorker.ts",
  "unplaced: src/web/pwa/vite/groupArchive.ts",
  "unplaced: src/web/pwa/vite/hashedIconsPlugin.ts",
  "unplaced: src/web/pwa/vite/originMemberPacks.ts",
  "unplaced: src/web/pwa/vite/precachePlugin.ts",
  "upward import: src/text/phaser/uiGlyphPen.ts -> src/view/phaser/uiCommands.ts",
  "upward import: src/view/phaser/uiSubmitter.ts -> src/text/phaser/uiGlyphPen.ts",
  "upward import: src/web/input/dom/holdActions.ts -> src/web/ui/dom/domPress.ts",
];

const BANDS: SourceBands = [
  ["Foundation", [["rect.ts"], ["random.ts"]]],
  ["Model", [["model"]]],
  ["Engine and views", [["view/dom"]]],
  ["Support", [["build/**"]]],
];

function problems(sources: Readonly<Record<string, string>>): string[] {
  return sourceBandProblems({
    bands: BANDS,
    paths: Object.keys(sources),
    readSource: (path) => sources[path]!,
  });
}

it("accepts downward imports through entries, inside an area and from tests", () => {
  expect(
    problems({
      "src/build/vite/plugin.ts": 'import { a } from "../../model/index.ts";',
      "src/model/a.ts": 'import type { R } from "../rect.ts"; export const a = 1;',
      "src/model/a.test.ts": 'import "../view/dom/view.ts";',
      "src/model/index.ts": 'export { a } from "./a.ts";',
      "src/random.ts": 'import "./rect.ts";',
      "src/rect.ts": "export type R = 1;",
      "src/view/dom/view.ts": 'import { a } from "../../model/index.ts";',
    }),
  ).toEqual([]);
});

it("reports upward, same-layer, non-entry and support imports and unplaced modules", () => {
  expect(
    problems({
      "src/model/a.ts": 'import type { V } from "../view/dom/view.ts";',
      "src/model/index.ts": "export {};",
      "src/rect.ts": 'import "./random.ts"; import "../scripts/tool.ts";',
      "src/random.ts": "export {};",
      "src/stray.ts": "export {};",
      "src/view/dom/view.ts": 'import "../../model/a.ts";',
      "scripts/tool.ts": "export {};",
    }),
  ).toEqual([
    "non-entry import: src/view/dom/view.ts -> src/model/a.ts",
    "support import: src/rect.ts -> scripts/tool.ts",
    "unplaced: src/stray.ts",
    "upward import: src/model/a.ts -> src/view/dom/view.ts",
    "upward import: src/rect.ts -> src/random.ts",
  ]);
});

it("reports runtime cycles but not type-only ones", () => {
  expect(
    problems({
      "src/model/a.ts": 'import { b } from "./b.ts"; export const a = 1;',
      "src/model/b.ts": 'import { a } from "./a.ts"; export const b = 1;',
      "src/model/c.ts": 'import type { D } from "./d.ts"; export type C = 1;',
      "src/model/d.ts": 'import type { C } from "./c.ts"; export type D = 1;',
      "scripts/x.ts": 'export * from "./y.ts";',
      "scripts/y.ts": 'export { x } from "./x.ts";',
    }),
  ).toEqual(["cycle: scripts/x.ts, scripts/y.ts", "cycle: src/model/a.ts, src/model/b.ts"]);
});

it("reports exactly the known violations in the kit, its scripts and its browser checks", () => {
  const paths = ["src", "scripts", "tests/e2e"].flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `${directory}/${name.replaceAll("\\", "/")}`),
  );
  expect(paths.length).toBeGreaterThan(100);
  expect(
    sourceBandProblems({
      bands: SOURCE_BANDS,
      paths,
      readSource: (path) => readFileSync(join(root, path), "utf8"),
    }),
  ).toEqual(KNOWN_VIOLATIONS);
});
