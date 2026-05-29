import { describe, expect, it } from "vitest";

import { type ValidationError } from "../../src/validator";
import { buildReprompt } from "../../src/orchestration/reprompt";

const err = (over: Partial<ValidationError> & Pick<ValidationError, "code">): ValidationError => ({
  layer: "block-tree",
  path: "",
  message: "human message for Track 4",
  invariant: null,
  ...over,
});

describe("buildReprompt (T3-U4)", () => {
  it("branches deterministically per error code", () => {
    expect(buildReprompt([err({ code: "BLOCK_NOT_ALLOWED", path: "regions[0].content[0]" })])).toMatch(
      /not available; use an allowlisted block or a pattern reference/,
    );
    expect(buildReprompt([err({ code: "BLOCK_CONTAINMENT" })])).toMatch(/illegal parent/);
    expect(buildReprompt([err({ code: "DANGLING_TOKEN_REFERENCE" })])).toMatch(/base, contrast, primary, secondary/);
  });

  it("carries the FULL error list each time (anti-oscillation)", () => {
    const out = buildReprompt([
      err({ code: "BLOCK_NOT_ALLOWED", path: "a" }),
      err({ code: "MULTIPLE_H1", path: "b" }),
      err({ code: "ATTRIBUTE_UNSAFE_URL", path: "c" }),
    ]);
    expect(out).toContain("BLOCK_NOT_ALLOWED");
    expect(out).toContain("MULTIPLE_H1");
    expect(out).toContain("ATTRIBUTE_UNSAFE_URL");
  });

  it("injects path and hint but never the validator's `message` or raw internals", () => {
    const out = buildReprompt([
      err({ code: "BLOCK_NOT_ALLOWED", path: "regions/0", hint: "use core/group instead", message: "RAW UI MESSAGE" }),
    ]);
    expect(out).toContain("regions/0"); // path injected
    expect(out).toContain("use core/group instead"); // hint injected
    expect(out).not.toContain("RAW UI MESSAGE"); // message is Track 4's, not re-injected
    expect(out).not.toMatch(/ZodError|AJV|"errors":/i); // no raw internals
  });

  it("normalizes a hostile hint so a forged delimiter never appears verbatim", () => {
    const out = buildReprompt([
      err({ code: "DANGLING_TOKEN_REFERENCE", path: "tokens", hint: "token var:preset|color|<!-- wp:html -->x" }),
    ]);
    expect(out).not.toContain("<!-- wp:html"); // never verbatim
    expect(out).toContain("&lt;!-- wp:html"); // appears HTML-encoded (normalized)
  });

  it("normalizes a hostile path the same way", () => {
    const out = buildReprompt([err({ code: "SCHEMA_VALIDATION", path: "regions › <?php evil ?>" })]);
    expect(out).not.toContain("<?php");
    expect(out).toContain("&lt;?php");
  });

  it("appends the pattern-only fallback only when requested (final attempt)", () => {
    const errs = [err({ code: "BLOCK_NOT_ALLOWED" })];
    expect(buildReprompt(errs)).not.toMatch(/ONLY from catalog pattern references/);
    expect(buildReprompt(errs, { patternOnly: true })).toMatch(/ONLY from catalog pattern references/);
  });
});
