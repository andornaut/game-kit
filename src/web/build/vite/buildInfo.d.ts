// The build constants gameViteConfig defines, for a game's code that reads them. Kit modules take
// these values as parameters instead. Reference this from the game's own declarations:
//
//   /// <reference types="@andornaut/game-kit/build/buildInfo" />
//
// package.json's version.
declare const __APP_VERSION__: string;
// Full clean source identity shared with grouped precache, unavailable on dirty or unknown builds.
declare const __BUILD_ID__: string | undefined;
// The commit's 8-character hash, or "dev" when the build knew none (build/buildVersion).
declare const __COMMIT__: string;
