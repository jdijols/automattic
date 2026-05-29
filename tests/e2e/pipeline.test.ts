// @vitest-environment jsdom
//
// U11 — the end-to-end integration test the brief mandates (R8). It runs the WHOLE
// Track-1 backbone as one flow for each positive archetype:
//
//   IR  →  validateIR (layers 1–3)  →  assembleThemeFiles (layer 4 inside)  →
//          byte-reproducible .zip  →  WordPress Playground install/activate gate
//
// asserting zero errors at every stage. Plus a regression guard: a deliberately
// broken fixture must fail at the EXPECTED stage with the EXPECTED structured
// error, never silently slipping through to a shipped theme.
//
// This is the SLOW gate (it boots WASM WordPress), so it lives under tests/e2e/**
// — excluded from the fast unit gate, run by `npm run test:slow`, and gated in CI
// to PRs that touch the assembler/blocks/harness/fixtures.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assembleThemeFiles } from "../../src/assembler/index";
import { packZip } from "../../src/assembler/zip";
import { validateIR } from "../../src/validator/index";
import { irSchema } from "../../src/ir/schema";
import { assertActiveTheme, bootPlayground, installTheme, type Playground } from "../../src/harness/run";

const repo = (...s: string[]): string => resolve(process.cwd(), ...s);

interface Fixture {
  input: unknown;
  expectedCode?: string;
  expectedInvariant?: string;
}

function loadFixture(relPath: string): Fixture {
  return JSON.parse(readFileSync(repo("fixtures", relPath), "utf8")) as Fixture;
}

const ARCHETYPES = [
  { name: "blog", slug: "aurora-blog", path: "positive/blog/blog.json" },
  { name: "portfolio", slug: "lumen-portfolio", path: "positive/portfolio/portfolio.json" },
  { name: "landing", slug: "ascent-landing", path: "positive/landing/landing.json" },
] as const;

let pg: Playground;

beforeAll(async () => {
  pg = await bootPlayground();
}, 180_000);

afterAll(async () => {
  await pg?.dispose();
});

describe("end-to-end pipeline: IR → validate → assemble → zip → Playground gate", () => {
  for (const arc of ARCHETYPES) {
    it(`${arc.name}: traverses the whole pipeline to a green gate with zero errors`, async () => {
      const fixture = loadFixture(arc.path);

      // Stage 1 — validate (layers 1–3). Zero errors. validateIR is the
      // multi-layer correctness gate (allowlist, grammar, theme.json) and returns
      // the lenient IRValidated type; once it passes, the same input is a valid
      // strict IR, obtained via irSchema.parse — the typed artifact the assembler
      // consumes (the U3 contract type, distinct from U4's lenient error type).
      const validated = validateIR(fixture.input);
      expect(validated.ok, JSON.stringify(validated.ok ? null : validated.errors)).toBe(true);
      if (!validated.ok) return; // unreachable after the assert; narrows the type
      const ir = irSchema.parse(fixture.input);

      // Stage 2 — assemble (layer 4 runs inside; throws AssemblyError on any finding).
      const files = assembleThemeFiles(ir);
      expect(files.find((f) => f.path === "templates/index.html")).toBeDefined();

      // Stage 3 — byte-reproducible package.
      const zip = await packZip(files, arc.slug);
      expect(zip.byteLength).toBeGreaterThan(0);

      // Stage 4 — install + activate + the four Playground assertions. Zero failures.
      await installTheme(pg, zip, arc.slug);
      const result = await assertActiveTheme(pg, arc.slug);
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

describe("regression guard: a broken fixture fails at the expected stage", () => {
  it("a core/html node is rejected at the VALIDATE stage with the expected structured error", () => {
    const fixture = loadFixture("wp-html/reject-core-html-node.json");
    const validated = validateIR(fixture.input);

    // The pipeline must stop here — it never reaches assemble/zip/Playground.
    expect(validated.ok).toBe(false);
    if (validated.ok) return;

    const wpHtmlError = validated.errors.find((e) => e.invariant === "wp-html");
    expect(wpHtmlError, "expected a wp-html structured error").toBeDefined();
    expect(wpHtmlError?.code).toBe(fixture.expectedCode);
    expect(wpHtmlError?.invariant).toBe(fixture.expectedInvariant);
  });
});
