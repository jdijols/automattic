import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type ValidationError } from "../../src/validator";
import { diversityProxy, escapeAttemptOf, sanitizeCause } from "../../src/orchestration/telemetry";

const err = (over: Partial<ValidationError> & Pick<ValidationError, "code">): ValidationError => ({
  layer: "block-tree",
  path: "",
  message: "m",
  invariant: null,
  ...over,
});

describe("escapeAttemptOf (T3-U5)", () => {
  it("flags a rejection carrying a release-blocking invariant", () => {
    expect(escapeAttemptOf([err({ code: "BLOCK_NOT_ALLOWED", invariant: "wp-html" })])).toEqual({
      invariant: "wp-html",
      code: "BLOCK_NOT_ALLOWED",
    });
    expect(escapeAttemptOf([err({ code: "BLOCK_NOT_ALLOWED", invariant: "hallucinated-block-name" })])?.invariant).toBe(
      "hallucinated-block-name",
    );
    expect(escapeAttemptOf([err({ code: "THEME_JSON_INVALID", invariant: "invalid-theme-json" })])?.invariant).toBe(
      "invalid-theme-json",
    );
  });

  it("does NOT flag an ordinary structural mistake (e.g. containment, invariant null)", () => {
    expect(escapeAttemptOf([err({ code: "BLOCK_CONTAINMENT" })])).toBeNull();
    expect(escapeAttemptOf([])).toBeNull();
  });
});

describe("sanitizeCause (T3-U5)", () => {
  it("redacts an Authorization header (and other credential fields) — value never survives", () => {
    const out = sanitizeCause({ headers: { Authorization: "Bearer sk-secret-123", "content-type": "application/json" } });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("sk-secret-123");
    expect(serialized).toContain("application/json"); // non-credential fields are preserved
  });

  it("redacts credential keys case-insensitively and at depth, including in arrays", () => {
    const out = sanitizeCause({
      nested: [{ apiKey: "k1" }, { request: { headers: { "X-API-Key": "k2", Cookie: "session=abc" } } }],
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("k1");
    expect(serialized).not.toContain("k2");
    expect(serialized).not.toContain("session=abc");
  });

  it("scrubs a secret carried in an Error message (non-enumerable) — the common provider cause shape", () => {
    const out = sanitizeCause(new Error("401 from https://api/v1?api-key=sk-live-123 — Authorization: Bearer sk-tok-9"));
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("sk-live-123");
    expect(serialized).not.toContain("sk-tok-9");
    expect(serialized).toContain("[redacted]");
  });

  it("scrubs a value-borne secret in a plain string value (not just by key name)", () => {
    const out = sanitizeCause({ detail: "retry failed, token=sk-secret-xyz" });
    expect(JSON.stringify(out)).not.toContain("sk-secret-xyz");
  });

  it("passes through primitives unchanged", () => {
    expect(sanitizeCause("plain")).toBe("plain");
    expect(sanitizeCause(42)).toBe(42);
    expect(sanitizeCause(null)).toBeNull();
  });
});

describe("telemetry contract — no U4↔U5 cycle (T3-U5, criterion 5)", () => {
  it("telemetry.ts imports nothing from the emitter modules (dependency direction is one-way)", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/orchestration/telemetry.ts", import.meta.url)), "utf8");
    for (const emitter of ["./retry-loop", "./generate", "./provider"]) {
      expect(src, `telemetry.ts must not import from ${emitter}`).not.toContain(`from "${emitter}"`);
    }
  });
});

describe("diversityProxy (T3-U5)", () => {
  const heroGen = { regions: [{ content: [{ pattern: "hero-cover" }] }] };
  const footerGen = { regions: [{ content: [{ pattern: "site-footer" }] }] };

  it("is lower for repeated single-pattern output than for varied output", () => {
    const repeated = diversityProxy([heroGen, heroGen, heroGen]);
    const varied = diversityProxy([heroGen, footerGen, { regions: [{ content: [{ block: "core/group" }] }] }]);

    expect(repeated.distinctPatterns).toBe(1);
    expect(repeated.distinctCompositions).toBe(1);
    expect(varied.distinctPatterns).toBeGreaterThan(repeated.distinctPatterns);
    expect(varied.distinctCompositions).toBeGreaterThan(repeated.distinctCompositions);
    expect(varied.sampleSize).toBe(3);
  });

  it("counts distinct compositions by node-name multiset, descending into innerBlocks", () => {
    const a = { regions: [{ content: [{ block: "core/group", innerBlocks: [{ block: "core/heading" }] }] }] };
    const b = { regions: [{ content: [{ block: "core/group", innerBlocks: [{ block: "core/paragraph" }] }] }] };
    expect(diversityProxy([a, a]).distinctCompositions).toBe(1);
    expect(diversityProxy([a, b]).distinctCompositions).toBe(2);
  });
});
