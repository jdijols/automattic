import { describe, expect, it } from "vitest";

import { validateIR } from "./index";
import { validBlogIR, wrapNodes } from "./test-helpers";

describe("validator orchestrator — fail-closed, fixed order", () => {
  it("passes a valid IR and returns a typed artifact", () => {
    const result = validateIR(validBlogIR());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.irVersion).toBe(1);
  });

  it("never throws and never silently passes on garbage input", () => {
    for (const garbage of [null, 42, "x", {}, { regions: "nope" }]) {
      const result = validateIR(garbage);
      expect(result.ok).toBe(false);
    }
  });

  it("short-circuits at layer 1 — a schema failure does not surface layer-2 errors", () => {
    const result = validateIR({ not: "an ir" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.layer === "schema")).toBe(true);
    }
  });

  it("short-circuits at layer 2a before layer 2b (ordering)", () => {
    // A hallucinated block (2a) AND two h1s (2b): only the 2a error should surface.
    const ir = wrapNodes([
      { block: "core/scroll-spy" },
      { block: "core/heading", attributes: { level: 1 } },
      { block: "core/heading", attributes: { level: 1 } },
    ]);
    const result = validateIR(ir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "BLOCK_NOT_ALLOWED")).toBe(true);
      expect(result.errors.some((e) => e.code === "MULTIPLE_H1")).toBe(false);
    }
  });
});
