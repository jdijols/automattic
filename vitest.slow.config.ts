import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The SLOW gate: WordPress Playground install/activate tests (U10). These boot a
// headless WASM WordPress (pinned WP 6.6 / PHP 8.2) and take tens of seconds, so
// they are kept OUT of the fast unit gate (vitest.config.ts excludes
// tests/harness/**) and run only via `npm run test:slow`. U11 wires the CI
// fast/slow split so this job runs only when the assembler/serializer/fixtures
// change.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // jsdom: the assembler imports @wordpress/blocks via the DOM runtime, which
    // needs window/document present at import time (the same reason the assembler
    // unit tests run under jsdom). Playground's own worker threads are unaffected.
    environment: "jsdom",
    include: ["tests/harness/**/*.test.ts"],
    // A cold boot downloads + instantiates the WASM runtime; give it room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    server: {
      deps: { inline: [/@wordpress\//] },
    },
  },
});
