import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the tsconfig `@/*` → ./src/* path alias so tests can import the app/
  // server route (which uses the alias) the same way the build resolves it.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Playwright-driven end-to-end tests are added in U11 and run under a
    // separate slow CI job, not the fast unit gate.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
