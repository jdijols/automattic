import { describe, expect, it } from "vitest";

import { ERROR_CODES, makeError } from "./errors";

describe("structured error format", () => {
  it("declares a code enum spanning all four layers (incl. layer-3 and layer-4)", () => {
    // The contract is whole at the U7 freeze even though L3/L4 producers land later.
    for (const code of [
      "SCHEMA_VALIDATION", // layer 1
      "BLOCK_NOT_ALLOWED", // layer 2a
      "MULTIPLE_H1", // layer 2b
      "THEME_JSON_INVALID", // layer 3 (U5)
      "RAW_HTML_DETECTED", // layer 4 (U9)
      "UNRESOLVED_BLOCK_NAME", // layer 4 (U9)
    ] as const) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it("produces the frozen field set, defaulting invariant to null", () => {
    const error = makeError({
      code: "BLOCK_NOT_ALLOWED",
      layer: "block-tree",
      path: "templates/index.html › core/scroll-spy",
      message: "Block 'core/scroll-spy' is not in the allowlist.",
    });
    expect(error).toEqual({
      code: "BLOCK_NOT_ALLOWED",
      layer: "block-tree",
      path: "templates/index.html › core/scroll-spy",
      message: "Block 'core/scroll-spy' is not in the allowlist.",
      invariant: null,
    });
  });

  it("caps the hint and strips newlines so it cannot leak a schema fragment", () => {
    const error = makeError({
      code: "SCHEMA_VALIDATION",
      layer: "schema",
      path: "regions",
      message: "Invalid.",
      hint: `${"x".repeat(300)}\n{ "type": "object" }`,
    });
    expect(error.hint!.length).toBeLessThanOrEqual(200);
    expect(error.hint).not.toContain("\n");
  });
});
