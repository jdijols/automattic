import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import {
  type IRGenerated,
  type IRValidated,
  irGenerationJsonSchema,
  irGenerationSchema,
} from "../../src/orchestration/ir-views";

const blogInput = (): unknown => {
  const blog = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../fixtures/positive/blog/blog.json", import.meta.url)), "utf8"),
  ) as { input: unknown };
  return blog.input;
};

describe("ir-views — generation view (T3-U1)", () => {
  describe("envelope is tight", () => {
    it("accepts a positive-corpus IR (the envelope matches the source contract)", () => {
      expect(irGenerationSchema.safeParse(blogInput()).success).toBe(true);
    });

    it("rejects an invented top-level key (additionalProperties:false is preserved)", () => {
      const ir = blogInput() as Record<string, unknown>;
      const result = irGenerationSchema.safeParse({ ...ir, smuggled: true });
      expect(result.success).toBe(false);
    });

    it("rejects an invalid theme slug (envelope constraints survive the view split)", () => {
      const ir = blogInput() as { theme: Record<string, unknown> };
      const result = irGenerationSchema.safeParse({ ...ir, theme: { ...ir.theme, slug: "../../wp-config" } });
      expect(result.success).toBe(false);
    });

    it("requires at least one region", () => {
      const ir = blogInput() as Record<string, unknown>;
      expect(irGenerationSchema.safeParse({ ...ir, regions: [] }).success).toBe(false);
    });
  });

  describe("content is permissive (no recursive node reaches the model)", () => {
    it("accepts a region whose content holds a non-allowlisted block (deferred to the validator)", () => {
      const ir = {
        irVersion: 1,
        theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
        tokens: {},
        regions: [
          { kind: "template", name: "index", content: [{ block: "core/totally-made-up", innerBlocks: [] }] },
        ],
      };
      // The generation view is structural-envelope-only; an unknown block is the
      // VALIDATION view's job (BLOCK_NOT_ALLOWED at layer 2a), not this view's.
      expect(irGenerationSchema.safeParse(ir).success).toBe(true);
    });

    it("accepts arbitrary content node shapes (content is z.array(z.unknown()))", () => {
      const ir = {
        irVersion: 1,
        theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
        tokens: {},
        regions: [{ kind: "template", name: "index", content: [{ anything: 123, nested: { deep: true } }] }],
      };
      expect(irGenerationSchema.safeParse(ir).success).toBe(true);
    });

    it("emits no recursive node into the model-facing schema (no innerBlocks / node $defs)", () => {
      const serialized = JSON.stringify(irGenerationJsonSchema);
      expect(serialized).not.toContain("innerBlocks");
      expect(serialized).not.toContain("blockNode");
    });
  });

  describe("provider-acceptable JSON Schema (#10240 / #4701 cannot fire)", () => {
    it("has a typed object root with no root allOf and no root $ref", () => {
      expect(irGenerationJsonSchema.type).toBe("object");
      expect(irGenerationJsonSchema).not.toHaveProperty("allOf");
      expect(irGenerationJsonSchema).not.toHaveProperty("$ref");
    });

    it("the emitted schema accepts a valid IR under a strict JSON-Schema validator", () => {
      const ajv = new Ajv2020({ strict: false });
      const validate = ajv.compile(irGenerationJsonSchema);
      expect(validate(blogInput()), JSON.stringify(validate.errors, null, 2)).toBe(true);
    });
  });

  describe("two views of one source", () => {
    // The `IRValidated` import at the top of this file is the real guard: tsc
    // (in the gate) fails if ir-views.ts stops re-exporting the validated view.
    // This case asserts the produce-side type is usable and matches the source.
    it("exports a usable generation-view type derived from the source envelope", () => {
      const produced: IRGenerated = blogInput() as IRGenerated;
      expect(produced.irVersion).toBe(1);
      expect(produced.regions.length).toBeGreaterThan(0);
      // The validated view is the produce-view's downstream guarantee; reference
      // it so an accidental removal of the re-export fails this file under tsc.
      const guarantee: IRValidated | undefined = undefined;
      expect(guarantee).toBeUndefined();
    });
  });
});
