import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The EXPERIMENT gate (T4-U1): the §3.6 first-try-success live runner. Unlike the
// fast gate (vitest.config.ts: tests/** + src/**) and the slow Playground gate
// (vitest.slow.config.ts: tests/harness/** + tests/e2e/**), this config targets
// the live runner that lives OUTSIDE those globs — experiments/**/*.live.test.ts.
//
// It is NEVER run in CI. The human runs it deliberately with their own key:
//
//   ANTHROPIC_API_KEY=… npm run experiment
//
// The live runner self-skips when the key is absent, so an accidental `vitest run`
// against this config spends nothing. A single run drives both arms over the
// corpus (3 archetypes × k=3) through the real provider, so the timeout is large.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // node: the experiment exercises orchestration + the validator (layers 1–3)
    // only — it never assembles, so it does not need the jsdom runtime the
    // @wordpress/blocks serializer requires.
    environment: "node",
    include: ["experiments/**/*.live.test.ts"],
    // A full run makes many real provider calls (both arms × 9 prompts × the retry
    // budget); give the whole file room.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
