import { describe, expect, it } from "vitest";

import { layer1 } from "./layer1-schema";
import { nestGroups, validBlogIR, wrapNodes } from "./test-helpers";

describe("layer 1 — schema + structural bounds", () => {
  it("accepts a valid IR and returns the parsed artifact", () => {
    const result = layer1(validBlogIR());
    expect(result.ok).toBe(true);
  });

  it("rejects non-object input as MALFORMED_INPUT without throwing", () => {
    for (const garbage of [null, undefined, 42, "x", []]) {
      const result = layer1(garbage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("MALFORMED_INPUT");
        expect(result.errors[0]?.layer).toBe("schema");
      }
    }
  });

  it("rejects a missing required field with a schema-class error (no Zod internals leaked)", () => {
    const noTheme = wrapNodes([{ block: "core/paragraph" }]);
    delete noTheme.theme;
    const result = layer1(noTheme);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.layer === "schema")).toBe(true);
      expect(result.errors[0]?.code).toBe("SCHEMA_VALIDATION");
      // The message must be human-legible, not a raw ZodError dump.
      expect(typeof result.errors[0]?.message).toBe("string");
    }
  });

  it("rejects an invented node-level key (additionalProperties:false) at the schema layer", () => {
    const result = layer1(wrapNodes([{ block: "core/group", rawHtml: "<script>x</script>" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.layer).toBe("schema");
  });

  it("is LENIENT on block name so a hallucinated block reaches layer 2a", () => {
    // The published contract (U3) constrains generation via the block enum; the
    // VALIDATOR defends against untrusted output and must let a bad name through
    // layer 1 so layer 2a can emit a clean BLOCK_NOT_ALLOWED.
    const result = layer1(wrapNodes([{ block: "core/scroll-spy" }]));
    expect(result.ok).toBe(true);
  });

  it("rejects a tree past the depth bound BEFORE per-node work (DoS guard), without throwing", () => {
    const result = layer1(wrapNodes([nestGroups(12)]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("DEPTH_BOUND_EXCEEDED");
      expect(result.errors[0]?.layer).toBe("schema");
    }
  });

  it("does not stack-overflow on a pathologically deep tree (short-circuits cleanly)", () => {
    // The U3 finding: irSchema.safeParse alone throws RangeError ~1k+ deep. The
    // layer-1 raw pre-walk must reject such input cleanly, never throw.
    let result: ReturnType<typeof layer1> | undefined;
    expect(() => {
      result = layer1(wrapNodes([nestGroups(20000)]));
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) expect(result.errors[0]?.code).toBe("DEPTH_BOUND_EXCEEDED");
  });
});
