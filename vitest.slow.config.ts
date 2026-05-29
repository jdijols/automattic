import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The SLOW gate: WordPress Playground tests that boot a headless WASM WordPress
// (pinned WP 6.6 / PHP 8.2) and take tens of seconds —
//   - tests/harness/** : the U10 install/activate gate (per-assertion bite tests)
//   - tests/e2e/**     : the U11 full-pipeline integration test (R8)
// They are kept OUT of the fast unit gate (vitest.config.ts excludes both dirs)
// and run via `npm run test:slow`. The CI slow job (ci-playground.yml) runs this
// only when the assembler/blocks/harness/fixtures change.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // jsdom: the assembler imports @wordpress/blocks via the DOM runtime, which
    // needs window/document present at import time (the same reason the assembler
    // unit tests run under jsdom). Playground's own worker threads are unaffected.
    environment: "jsdom",
    include: ["tests/harness/**/*.test.ts", "tests/e2e/**/*.test.ts"],
    // Run the slow files SEQUENTIALLY. Every boot maps the same on-disk site dir
    // (~/.wordpress-playground/sites/<hash> is keyed by WP/PHP version), so two
    // Playground instances running in parallel would race on the same filesystem
    // and corrupt each other. One file at a time keeps each boot isolated.
    fileParallelism: false,
    // A cold boot downloads + instantiates the WASM runtime; give it room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    server: {
      deps: { inline: [/@wordpress\//] },
    },
  },
});
