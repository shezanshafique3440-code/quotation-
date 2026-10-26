import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next preserves JSX for its own compiler; component tests need it lowered.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
