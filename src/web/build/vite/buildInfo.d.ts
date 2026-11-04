// The build constants gameViteConfig defines, for a game's code that reads them. Kit modules take
// these values as parameters instead. Reference this from the game's own declarations:
//
//   /// <reference types="@andornaut/game-kit/web/build/vite/buildInfo" />
//
// package.json's version.
declare const __APP_VERSION__: string;
// The commit's 8-character hash, or "dev" when the build knew none (web/build/buildVersion).
declare const __COMMIT__: string;
