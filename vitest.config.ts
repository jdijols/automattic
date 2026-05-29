import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Playwright-driven end-to-end tests are added in U11 and run under a
    // separate slow CI job, not the fast unit gate.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
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
