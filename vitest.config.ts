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
    // The slow gates run separately, not in the fast unit gate:
    //   - tests/harness/** — WordPress Playground install/activate (U10), via
    //     `npm run test:slow` (vitest.slow.config.ts).
    //   - tests/e2e/** — Playwright end-to-end, added in U11.
    exclude: ["tests/harness/**", "tests/e2e/**", "node_modules/**", ".next/**"],
    server: {
      deps: {
        // `@wordpress/blocks`' ESM build (`build-module`) does a bare `.json`
        // import without the `with { type: "json" }` attribute Node's native ESM
        // loader now requires — importing it directly throws
        // ERR_IMPORT_ATTRIBUTE_MISSING (the U8 serializer-oracle discovery).
        // Inlining the `@wordpress/*` packages routes them through Vite/esbuild,
        // which transforms JSON imports correctly. The serializer parity tests
        // run under the `jsdom` environment (per-file pragma); see serializer.ts.
        inline: [/@wordpress\//],
      },
    },
  },
});
