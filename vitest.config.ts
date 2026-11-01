import { defineConfig } from "vitest/config";

export default defineConfig({
  // The build globals src/build/buildInfo.d.ts declares, which a game's bundler defines.
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0"),
    __COMMIT__: JSON.stringify("dev"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
