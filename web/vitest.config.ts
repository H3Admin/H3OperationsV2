/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Vitest config — PURE unit tests only this slice (§7.2: cover the feature
// resolver). Node environment; no jsdom / React component setup yet. Kept
// separate from vite.config.ts so the TanStack Router plugin doesn't run during
// tests. The @ alias mirrors vite.config.ts so `@/…` imports resolve in tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
