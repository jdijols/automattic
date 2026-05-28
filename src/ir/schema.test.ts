import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { irJsonSchema } from "./json-schema";
import { MAX_DEPTH, irSchema, paramSlotSchema, querySchema } from "./schema";

// A representative blog IR: hero patternRef + a template-region query loop +
// a footer part. Exercises the envelope, both node arms, tokens, and params.
const blogIR = {
  irVersion: 1,
  theme: {
    slug: "aurora-blog",
    title: "Aurora",
    author: "Jane Maker",
    description: "A dark-mode blog for writers.",
    wpVersionTarget: "6.6",
  },
  tokens: {
    colors: [
      { slug: "base", color: "#0b0b0f" },
      { slug: "contrast", color: "#f5f5f7" },
    ],
    fontSizes: [{ slug: "medium", size: "1.125rem" }],
    spacing: [{ slug: "50", size: "1.5rem" }],
  },
  regions: [
    {
      kind: "template",
      name: "index",
      content: [
        {
          pattern: "hero-cover",
          params: {
            headline: { kind: "text", value: "Words in the dark" },
            background: { kind: "tokenRef", value: "base" },
          },
        },
        {
          block: "core/query",
          nodeKind: "template-region",
          attributes: { query: { perPage: 10, postType: "post" } },
          innerBlocks: [
            {
              block: "core/post-template",
              nodeKind: "template-region",
              innerBlocks: [{ block: "core/post-title" }, { block: "core/post-excerpt" }],
            },
          ],
        },
      ],
    },
    { kind: "part", name: "footer", content: [{ pattern: "site-footer" }] },
  ],
};

describe("IR Zod schema — envelope", () => {
  it("parses a representative blog IR", () => {
    const result = irSchema.safeParse(blogIR);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("rejects an invented blockNode key via additionalProperties:false", () => {
    expect(
      irSchema.safeParse(wrap({ block: "core/group", rawHtml: "<script>x</script>" })).success,
    ).toBe(false);
  });

  it("rejects an invented top-level key via additionalProperties:false", () => {
    expect(
      irSchema.safeParse({ ...wrap({ block: "core/paragraph" }), customCss: "body{}" }).success,
    ).toBe(false);
  });

  it("rejects a malformed theme slug", () => {
    expect(irSchema.safeParse(withTheme({ slug: "Has Spaces" })).success).toBe(false);
  });

  it("requires wpVersionTarget to be the pinned 6.6", () => {
    expect(irSchema.safeParse(withTheme({ wpVersionTarget: "6.5" })).success).toBe(false);
  });
});

describe("IR Zod schema — blockNode", () => {
  it("compiles the U2 allowlist into the block enum (hallucinated names fail at the schema layer)", () => {
    expect(irSchema.safeParse(wrap({ block: "core/hero-section" })).success).toBe(false);
  });

  it("enforces innerBlocks maxItems and text maxLength bounds", () => {
    const tooManyChildren = {
      block: "core/group",
      innerBlocks: Array.from({ length: 33 }, () => ({ block: "core/paragraph" })),
    };
    expect(irSchema.safeParse(wrap(tooManyChildren)).success).toBe(false);

    expect(irSchema.safeParse(wrap({ block: "core/paragraph", text: "a".repeat(2001) })).success).toBe(
      false,
    );
    expect(irSchema.safeParse(wrap({ block: "core/paragraph", text: "a".repeat(2000) })).success).toBe(
      true,
    );
  });

  it("rejects a tree nested past the depth bound", () => {
    expect(irSchema.safeParse(wrap(nestGroups(MAX_DEPTH + 2))).success).toBe(false);
    expect(irSchema.safeParse(wrap(nestGroups(MAX_DEPTH - 1))).success).toBe(true);
  });

  it("round-trips an explicit template-region node-kind, distinct from static", () => {
    const parsed = irSchema.parse(blogIR);
    const query = parsed.regions[0]!.content[1]!;
    expect(query.nodeKind).toBe("template-region");
    // A node that omits nodeKind defaults to static.
    const staticParsed = irSchema.parse(wrap({ block: "core/paragraph" }));
    expect(staticParsed.regions[0]!.content[0]!.nodeKind).toBe("static");
  });
});

describe("IR Zod schema — node discrimination", () => {
  it("accepts a patternRef and a blockNode in the same content slot", () => {
    expect(
      irSchema.safeParse(wrap({ block: "core/paragraph" }, { pattern: "site-footer" })).success,
    ).toBe(true);
  });

  it("rejects an ambiguous node carrying both block and pattern keys", () => {
    expect(irSchema.safeParse(wrap({ block: "core/group", pattern: "hero-cover" })).success).toBe(
      false,
    );
  });

  it("rejects a near-patternRef with an extra key (additionalProperties:false)", () => {
    expect(irSchema.safeParse(wrap({ pattern: "hero-cover", bogus: 1 })).success).toBe(false);
  });
});

describe("IR Zod schema — patternRef.params slot map", () => {
  it("accepts each valid slot kind", () => {
    for (const slot of [
      { kind: "tokenRef", value: "base" },
      { kind: "text", value: "Hi" },
      { kind: "url", value: "https://example.com" },
      { kind: "scalar", value: 60 },
    ]) {
      expect(paramSlotSchema.safeParse(slot).success).toBe(true);
    }
  });

  it("rejects an unknown or missing slot kind", () => {
    expect(paramSlotSchema.safeParse({ kind: "html", value: "<b>" }).success).toBe(false);
    expect(paramSlotSchema.safeParse({ value: "no kind" }).success).toBe(false);
  });
});

describe("IR Zod schema — typed query sub-object", () => {
  it("bounds the query config", () => {
    expect(
      querySchema.safeParse({ perPage: 10, orderBy: "date", order: "desc", postType: "post" }).success,
    ).toBe(true);
    expect(querySchema.safeParse({ perPage: 0 }).success).toBe(false);
    expect(querySchema.safeParse({ postType: "product" }).success).toBe(false);
    expect(querySchema.safeParse({ orderBy: "bogus" }).success).toBe(false);
  });

  it("is an OUT-OF-BAND validator — irSchema does NOT bind query attributes (U4 layer-2a does)", () => {
    // Documents the contract boundary: attributes is an open bag at the IR
    // layer; query bounds are applied by the validator, not the schema.
    const unboundedQuery = wrap({
      block: "core/query",
      attributes: { query: { perPage: 999999, postType: "product" } },
    });
    expect(irSchema.safeParse(unboundedQuery).success).toBe(true);
    expect(querySchema.safeParse({ perPage: 999999, postType: "product" }).success).toBe(false);
  });
});

describe("IR Zod schema — guarantee boundary (no-raw-HTML is node-level, not attribute-level)", () => {
  it("structurally accepts HTML-bearing attribute values (sanitized downstream, not here)", () => {
    // The IR layer guarantees "no wp:html block", not "no HTML anywhere": rich-
    // text attribute values legitimately contain inline HTML. U2/U4/U8 own the
    // sanitization of attribute content; this pins that the IR schema does not.
    const richText = wrap({
      block: "core/paragraph",
      attributes: { content: "Visit <a href=\"https://example.com\">us</a>" },
    });
    expect(irSchema.safeParse(richText).success).toBe(true);
  });
});

describe("published JSON Schema", () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(irJsonSchema);

  it("validates the same positive fixture as the Zod schema", () => {
    expect(validate(blogIR), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("rejects the structural negatives the Zod schema rejects", () => {
    expect(validate(wrap({ block: "core/group", rawHtml: "x" }))).toBe(false);
    expect(validate(wrap({ block: "core/hero-section" }))).toBe(false);
    expect(validate(wrap({ block: "core/group", pattern: "hero-cover" }))).toBe(false);
  });
});

// --- helpers ---

/** Build a minimal valid IR envelope wrapping the given region-root nodes. */
function wrap(...nodes: unknown[]) {
  return {
    irVersion: 1,
    theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
    tokens: {},
    regions: [{ kind: "template", name: "index", content: nodes }],
  };
}

/** A valid envelope with the theme object overridden for envelope-level negatives. */
function withTheme(themeOverride: Record<string, unknown>) {
  return {
    ...wrap({ block: "core/paragraph" }),
    theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6", ...themeOverride },
  };
}

function nestGroups(depth: number): unknown {
  let n: Record<string, unknown> = { block: "core/paragraph" };
  for (let i = 0; i < depth - 1; i++) {
    n = { block: "core/group", innerBlocks: [n] };
  }
  return n;
}
