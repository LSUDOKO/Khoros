import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Workspace packages ship TypeScript source rather than a build artifact, so
 * Vitest is pointed at the entry files directly. Next resolves the same
 * packages through `transpilePackages` in next.config.mjs.
 */
const resolve = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@khoros/core": resolve("../../packages/core/src/index.ts"),
      "@khoros/scoring": resolve("../../packages/scoring/src/index.ts"),
      "@": resolve("./"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
