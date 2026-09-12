import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Lifeline test runner.
 *
 * `tests/graph.test.ts` runs against the LIVE Neo4j Aura instance configured in
 * `.env.local`, so the config does three things that matter:
 *
 *   1. maps the `@/…` path alias to ./src, exactly as tsconfig.json does, so
 *      tests import the same modules the app does;
 *   2. loads `.env.local` before any test module is imported (tests/setup.ts),
 *      because `getDriver()` reads the credentials at import-of-first-use time;
 *   3. serialises everything. The graph is shared, mutable state: two test
 *      files mutating it at once would make `resetToBaseline()` meaningless.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Aura is a remote instance and the recommendation query enumerates every
    // walk in the district — be generous.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    // One shared graph => one test file at a time, one test at a time.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
