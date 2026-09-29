import { defineConfig } from "vitest/config";

// End-to-end runs the compiled artefact in its own process, so there is nothing
// here for the coverage or mutation tooling to instrument — the point of this
// suite is the boot path, not the numbers.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
