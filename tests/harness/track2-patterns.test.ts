// @vitest-environment jsdom
//
// Track 2 pattern-library breadth — the WordPress Playground install/activate
// gate for each pattern admitted beyond the seed three. Boots ONE headless WP
// 6.6 / PHP 8.2 and proves every Track-2 archetype assembles, installs,
// activates, and passes all four gate assertions (zero core/html, every block
// resolves, no dropped theme.json keys, non-empty nav). This is the mandatory
// per-pattern gate: a new pattern is not done until it installs cleanly in real
// WordPress.
//
// SLOW gate — run via `npm run test:slow` (excluded from the fast unit gate).
// Kept SEPARATE from playground.test.ts (the seed/U10 bite tests) so Track 2 can
// extend its own coverage one pattern per PR without touching shared harness
// fixtures.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assembleThemeZip } from "../../src/assembler/index";
import { irSchema, type IR } from "../../src/ir/schema";
import {
  assertActiveTheme,
  bootPlayground,
  installTheme,
  type Playground,
} from "../../src/harness/run";

const repo = (...s: string[]): string => resolve(process.cwd(), ...s);

/** Load a positive fixture's IR by its directory/file name under fixtures/positive/. */
function loadPositiveIR(name: string): IR {
  const fx = JSON.parse(
    readFileSync(repo("fixtures", "positive", name, `${name}.json`), "utf8"),
  ) as { input: unknown };
  return irSchema.parse(fx.input);
}

let pg: Playground;

beforeAll(async () => {
  pg = await bootPlayground();
}, 180_000);

afterAll(async () => {
  await pg?.dispose();
});

/** Install a fixture's assembled zip + run the four-assertion gate. */
async function gateFixture(name: string, slug: string) {
  const zip = await assembleThemeZip(loadPositiveIR(name));
  await installTheme(pg, zip, slug);
  return assertActiveTheme(pg, slug);
}

describe("Track 2 patterns install, activate, and pass all four assertions", () => {
  it("hero-portfolio-dark (parameterized media-text split hero + footer-pattern nav)", async () => {
    const result = await gateFixture("portfolio-hero", "umbra-portfolio");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    // The defining case for this pattern: core/media-text is admitted to the
    // allowlist, so every block in the assembled artifact resolves to a
    // registered block — no block-resolution failure.
    expect(result.failures.filter((f) => f.check === "block-resolution")).toEqual([]);
  });

  it("landing-hero (parameterized centered hero + 3 feature columns + footer-pattern nav)", async () => {
    const result = await gateFixture("landing-hero", "lumo-landing");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("magazine-index (parameterized query/post-template grid + pagination + footer-pattern nav)", async () => {
    const result = await gateFixture("magazine-index", "ledger-magazine");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    // The query renders against a fresh install (default sample post); every
    // post-* block + pagination must resolve to a registered block.
    expect(result.failures.filter((f) => f.check === "block-resolution")).toEqual([]);
  });

  it("pricing-table (parameterized three-tier cards + feature lists + CTAs + footer-pattern nav)", async () => {
    const result = await gateFixture("pricing-table", "tier-pricing");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("testimonials-row (parameterized three-card social proof + avatars + footer-pattern nav)", async () => {
    const result = await gateFixture("testimonials-row", "chorus-proof");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
