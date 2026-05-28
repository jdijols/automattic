// The adversarial fixture corpus (origin §5.3) — the falsifiable CI gate that
// turns the "catch the three invariant classes" claim into a test. Each fixture
// is a JSON file declaring an input + expected outcome; this harness runs it
// through the right validator and asserts the EXACT code (+ invariant tag for
// negatives). A regression that changes which error fires turns a specific
// fixture red.
//
// Scope: this is the layer 1–3 corpus (the fast inner gate). The raw-`wp:html`
// byte-scan cases (layer 4) and the install-gate positives arrive in U9/U11.
// "100% catch" here means 100% on the ENUMERATED classes (origin §5.3 honesty
// boundary), not a universal proof.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type ValidationError } from "../src/validator/errors";
import { validateIR } from "../src/validator/index";
import { validateThemeJson } from "../src/validator/layer3-themejson";

interface Fixture {
  description: string;
  /** "ir" → validateIR (layers 1–3); "themejson" → validateThemeJson (layer 3 only). */
  target: "ir" | "themejson";
  expect: "reject" | "pass";
  expectedCode?: string;
  /** Asserted on the matching-code error when present; omit to skip. */
  expectedInvariant?: ValidationError["invariant"];
  input: unknown;
}

const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

function loadFixtures(dir: string): { rel: string; fixture: Fixture }[] {
  const out: { rel: string; fixture: Fixture }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".json")) {
        const fixture = JSON.parse(readFileSync(full, "utf8")) as Fixture;
        out.push({ rel: full.slice(fixturesDir.length + 1), fixture });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const fixtures = loadFixtures(fixturesDir);

function runFixture(fixture: Fixture): ValidationError[] {
  if (fixture.target === "themejson") return validateThemeJson(fixture.input);
  const result = validateIR(fixture.input);
  return result.ok ? [] : result.errors;
}

describe("adversarial corpus (origin §5.3)", () => {
  it("covers every invariant class plus a positive set", () => {
    const classes = new Set(fixtures.map((f) => f.rel.split("/")[0]));
    for (const cls of ["wp-html", "hallucinated", "invalid-themejson", "positive"]) {
      expect(classes.has(cls), `missing corpus class: ${cls}`).toBe(true);
    }
    // Guard against an accidentally-empty corpus silently passing CI.
    expect(fixtures.length).toBeGreaterThanOrEqual(18);
  });

  for (const { rel, fixture } of fixtures) {
    it(`${rel} — ${fixture.description}`, () => {
      const errors = runFixture(fixture);

      if (fixture.expect === "pass") {
        expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
        return;
      }

      // Negative: must reject with the exact code (and invariant, if specified).
      expect(errors.length, "expected at least one error").toBeGreaterThan(0);
      expect(
        errors.some((e) => e.code === fixture.expectedCode),
        `expected code ${fixture.expectedCode}, got ${JSON.stringify(errors.map((e) => e.code))}`,
      ).toBe(true);
      // Sole-cause: a single-defect negative must reject ONLY for the targeted
      // reason, so the fixture can never pass for the wrong reason if the
      // targeted rule regresses (closes the some()-based wrong-reason window).
      expect(
        errors.every((e) => e.code === fixture.expectedCode),
        `expected ${fixture.expectedCode} to be the sole cause, got ${JSON.stringify(errors.map((e) => e.code))}`,
      ).toBe(true);
      if (fixture.expectedInvariant !== undefined) {
        expect(
          errors.some(
            (e) => e.code === fixture.expectedCode && e.invariant === fixture.expectedInvariant,
          ),
          `expected invariant ${fixture.expectedInvariant} on code ${fixture.expectedCode}`,
        ).toBe(true);
      }
      // No error may leak a raw AJV/Zod internal (the §8.3 boundary).
      for (const e of errors) {
        expect(typeof e.message).toBe("string");
        expect(e.message).not.toContain("schemaPath");
      }
    });
  }
});
