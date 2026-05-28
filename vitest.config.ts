import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Playwright-driven end-to-end tests are added in U11 and run under a
    // separate slow CI job, not the fast unit gate.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
