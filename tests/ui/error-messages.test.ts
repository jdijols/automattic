// T4-U3 — the §5.2 structured-error → UI-message mapping. The route returns a .zip
// on 200 and a structured JSON error otherwise; this turns each (status, body) into
// field-level messages (description / criteria / form) plus, for a 422, the legible
// per-issue list the validator emits ({code, layer, path, message}). Tested so the
// React layer only ever renders pre-shaped, human-legible text.
import { describe, expect, it } from "vitest";

import { MAX_ISSUES, describeError } from "../../app/lib/error-messages";

describe("describeError (T4-U3)", () => {
  it("400 input_too_long → a field error on the description", () => {
    const d = describeError(400, { error: "input_too_long", maxLength: 4000 });
    expect(d.fieldErrors).toEqual([{ field: "description", message: expect.stringMatching(/4000|too long/i) }]);
    expect(d.issues).toEqual([]);
  });

  it("400 invalid_criteria → a field error on the criteria form", () => {
    const d = describeError(400, { error: "invalid_criteria" });
    expect(d.fieldErrors[0]!.field).toBe("criteria");
    expect(d.fieldErrors[0]!.message).toMatch(/color|hex|font|criteria/i);
  });

  it("400 invalid_request → a form-level error", () => {
    const d = describeError(400, { error: "invalid_request" });
    expect(d.fieldErrors[0]!.field).toBe("form");
  });

  it("422 failed → the per-issue validator list, rendering each message + code/layer/path", () => {
    const d = describeError(422, {
      status: "failed",
      errors: [
        { code: "BLOCK_NOT_ALLOWED", layer: "block-tree", path: "templates/index.html › core/foo", message: "Block core/foo is not allowed.", invariant: "hallucinated-block-name" },
        { code: "DANGEROUS_CSS", layer: "theme-json", path: "tokens.color.primary", message: "Unsafe CSS value.", invariant: "invalid-theme-json" },
      ],
    });
    expect(d.issues).toHaveLength(2);
    expect(d.issues[0]).toMatchObject({
      code: "BLOCK_NOT_ALLOWED",
      layer: "block-tree",
      path: "templates/index.html › core/foo",
      message: "Block core/foo is not allowed.",
    });
    expect(d.title).toMatch(/valid|generate/i);
  });

  it("422 with a non-array errors payload degrades to a single legible form error, never throws", () => {
    const d = describeError(422, { status: "failed" });
    expect(d.issues).toEqual([]);
    expect(d.fieldErrors[0]!.field).toBe("form");
  });

  it("caps an oversized 422 issue list at MAX_ISSUES and surfaces the cut (no silent truncation)", () => {
    const many = Array.from({ length: MAX_ISSUES + 7 }, (_, i) => ({
      code: "BLOCK_NOT_ALLOWED",
      layer: "block-tree",
      path: `regions[${i}]`,
      message: "nope",
    }));
    const d = describeError(422, { status: "failed", errors: many });
    expect(d.issues).toHaveLength(MAX_ISSUES);
    expect(d.fieldErrors[0]!.field).toBe("form");
    expect(d.fieldErrors[0]!.message).toMatch(/7 more/);
  });

  it("clamps an oversized single field so one huge string can't bloat the DOM", () => {
    const huge = "x".repeat(5000);
    const d = describeError(422, {
      status: "failed",
      errors: [{ code: "DANGEROUS_CSS", layer: "theme-json", path: huge, message: huge }],
    });
    expect(d.issues[0]!.message.length).toBeLessThan(huge.length);
    expect(d.issues[0]!.path.length).toBeLessThan(huge.length);
  });

  it("429 rate_limited → a form error that mentions slowing down / too many requests", () => {
    const d = describeError(429, { error: "rate_limited" });
    expect(d.fieldErrors[0]!.field).toBe("form");
    expect(d.fieldErrors[0]!.message).toMatch(/too many|slow|moment|again/i);
  });

  it("502 generation_failed and 503 capacity_exhausted → distinct legible form errors", () => {
    const five02 = describeError(502, { error: "generation_failed" });
    const five03 = describeError(503, { error: "capacity_exhausted" });
    expect(five02.fieldErrors[0]!.field).toBe("form");
    expect(five03.fieldErrors[0]!.field).toBe("form");
    expect(five02.fieldErrors[0]!.message).not.toBe(five03.fieldErrors[0]!.message);
    expect(five03.fieldErrors[0]!.message).toMatch(/capacity|busy|later/i);
  });

  it("an unknown status → a generic form error, never throws or leaks the raw body", () => {
    const d = describeError(418, { error: "i_am_a_teapot", secret: "sk-leak" });
    expect(d.fieldErrors[0]!.field).toBe("form");
    expect(JSON.stringify(d)).not.toContain("sk-leak");
  });

  it("never surfaces a raw provider/credential string from a 502 body", () => {
    const d = describeError(502, { error: "generation_failed", detail: "Authorization: Bearer sk-secret" });
    expect(JSON.stringify(d)).not.toContain("sk-secret");
    expect(JSON.stringify(d)).not.toContain("Authorization");
  });
});
