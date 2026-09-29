import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // e2e needs a build and its own process; `bun run test:e2e` runs it.
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // schema.ts is types only, and index.ts is the two-line `node dist/index.js`
      // runner — the wiring it used to hold lives in bootstrap.ts, which is tested.
      exclude: ["src/db/schema.ts", "src/index.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
