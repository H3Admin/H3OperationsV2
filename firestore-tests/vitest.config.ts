import { defineConfig } from "vitest/config";

// Rules tests talk to the shared Firestore emulator, so: node environment (no
// jsdom), run files serially (no cross-file races on the one emulator instance),
// and generous timeouts for emulator round-trips.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
