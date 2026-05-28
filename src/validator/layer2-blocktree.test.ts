import { describe, expect, it } from "vitest";

import { layer1 } from "./layer1-schema";
import { layer2a, layer2b } from "./layer2-blocktree";
import { validBlogIR, wrapNodes } from "./test-helpers";

/** Parse through layer 1 (lenient) so layer-2 sees a typed tree, then run a pass. */
function parsed(ir: Record<string, unknown>) {
  const r = layer1(ir);
  if (!r.ok) throw new Error(`layer1 unexpectedly failed: ${JSON.stringify(r.errors)}`);
  return r.value;
}

describe("layer 2a — per-node structural validation", () => {
  it("passes a valid blog IR with zero errors", () => {
    expect(layer2a(parsed(validBlogIR()))).toEqual([]);
  });

  it("rejects a hallucinated block name with BLOCK_NOT_ALLOWED + invariant + path", () => {
    const errors = layer2a(parsed(wrapNodes([{ block: "core/scroll-spy" }])));
    const e = errors.find((x) => x.code === "BLOCK_NOT_ALLOWED");
    expect(e).toBeDefined();
    expect(e?.invariant).toBe("hallucinated-block-name");
    expect(e?.layer).toBe("block-tree");
    expect(e?.path).toContain("core/scroll-spy");
  });

  it("tags the disqualifying Custom HTML block with the wp-html invariant (any casing)", () => {
    for (const name of ["core/html", "core/HTML", "core/Html", " core/html "]) {
      const errors = layer2a(parsed(wrapNodes([{ block: name }])));
      const e = errors.find((x) => x.code === "BLOCK_NOT_ALLOWED");
      expect(e?.invariant, `casing ${JSON.stringify(name)}`).toBe("wp-html");
    }
  });

  it("rejects a patternRef wrapped in a closed-children container (containment cannot be bypassed)", () => {
    // toGrammarNode drops patternRef children, so this must be caught explicitly:
    // a pattern expands to its own root block, which columns' allowedChildren excludes.
    for (const parent of ["core/columns", "core/buttons", "core/list", "core/social-links"]) {
      const errors = layer2a(parsed(wrapNodes([{ block: parent, innerBlocks: [{ pattern: "site-footer" }] }])));
      expect(errors.some((e) => e.code === "BLOCK_CONTAINMENT"), parent).toBe(true);
    }
    // An open container (group) legitimately accepts a pattern child.
    expect(
      layer2a(parsed(wrapNodes([{ block: "core/group", innerBlocks: [{ pattern: "site-footer" }] }]))).some(
        (e) => e.code === "BLOCK_CONTAINMENT",
      ),
    ).toBe(false);
  });

  it("rejects a misplaced block (column at region root) with BLOCK_CONTAINMENT + path", () => {
    const errors = layer2a(parsed(wrapNodes([{ block: "core/column" }])));
    const e = errors.find((x) => x.code === "BLOCK_CONTAINMENT");
    expect(e).toBeDefined();
    expect(e?.path).toContain("core/column");
  });

  it("rejects out-of-range, unknown, and unsafe-URL attributes", () => {
    expect(
      layer2a(parsed(wrapNodes([{ block: "core/heading", attributes: { level: 7 } }]))).some(
        (e) => e.code === "ATTRIBUTE_OUT_OF_RANGE",
      ),
    ).toBe(true);
    expect(
      layer2a(parsed(wrapNodes([{ block: "core/heading", attributes: { bogus: 1 } }]))).some(
        (e) => e.code === "ATTRIBUTE_UNKNOWN",
      ),
    ).toBe(true);
    expect(
      layer2a(
        parsed(
          wrapNodes([
            { block: "core/buttons", innerBlocks: [{ block: "core/button", attributes: { url: "javascript:alert(1)" } }] },
          ]),
        ),
      ).some((e) => e.code === "ATTRIBUTE_UNSAFE_URL"),
    ).toBe(true);
  });

  it("rejects an out-of-bounds query config with QUERY_CONFIG_INVALID", () => {
    const errors = layer2a(
      parsed(wrapNodes([{ block: "core/query", attributes: { query: { perPage: 0 } } }])),
    );
    expect(errors.some((e) => e.code === "QUERY_CONFIG_INVALID")).toBe(true);
  });

  it("rejects a patternRef to an unknown pattern with PATTERN_NOT_FOUND", () => {
    const errors = layer2a(parsed(wrapNodes([{ pattern: "nonexistent-pattern" }])));
    expect(errors.some((e) => e.code === "PATTERN_NOT_FOUND")).toBe(true);
  });

  it("rejects a param whose kind mismatches the pattern's declared slot kind", () => {
    const errors = layer2a(
      parsed(
        wrapNodes([{ pattern: "hero-cover", params: { heading: { kind: "tokenRef", value: "base" } } }]),
      ),
    );
    expect(errors.some((e) => e.code === "PATTERN_PARAM_KIND_MISMATCH")).toBe(true);
  });
});

describe("layer 2b — post-composition document validation", () => {
  it("passes a valid blog IR with zero errors", () => {
    expect(layer2b(parsed(validBlogIR()))).toEqual([]);
  });

  it("rejects two h1s (passes 2a, fails 2b — proving both passes are needed)", () => {
    const twoH1 = wrapNodes([
      { block: "core/heading", attributes: { level: 1 }, text: "One" },
      { block: "core/heading", attributes: { level: 1 }, text: "Two" },
    ]);
    expect(layer2a(parsed(twoH1))).toEqual([]); // locally valid
    expect(layer2b(parsed(twoH1)).some((e) => e.code === "MULTIPLE_H1")).toBe(true);
  });

  it("rejects duplicate region names with REGION_NOT_UNIQUE", () => {
    const dup = {
      irVersion: 1,
      theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
      tokens: {},
      regions: [
        { kind: "part", name: "footer", content: [] },
        { kind: "part", name: "footer", content: [] },
      ],
    };
    expect(layer2b(parsed(dup)).some((e) => e.code === "REGION_NOT_UNIQUE")).toBe(true);
  });

  it("rejects a dangling var:preset token reference (the invalid-but-parseable class)", () => {
    const dangling = wrapNodes(
      [{ block: "core/group", attributes: { style: { color: { background: "var:preset|color|brand" } } } }],
      { colors: [{ slug: "base", color: "#000" }] },
    );
    const errors = layer2b(parsed(dangling));
    expect(errors.some((e) => e.code === "DANGLING_TOKEN_REFERENCE")).toBe(true);
  });

  it("rejects a dangling bare-slug color reference", () => {
    const dangling = wrapNodes(
      [{ block: "core/group", attributes: { backgroundColor: "brand" } }],
      { colors: [{ slug: "base", color: "#000" }] },
    );
    expect(layer2b(parsed(dangling)).some((e) => e.code === "DANGLING_TOKEN_REFERENCE")).toBe(true);
  });

  it("accepts WordPress core default presets that need not be declared (no false positive)", () => {
    const usingCoreDefaults = wrapNodes(
      [
        { block: "core/group", attributes: { textColor: "white", backgroundColor: "black" } },
        { block: "core/heading", attributes: { level: 2, fontSize: "large" } },
      ],
      { colors: [{ slug: "base", color: "#000" }] },
    );
    expect(layer2b(parsed(usingCoreDefaults))).toEqual([]);
  });

  it("accepts a resolvable token reference", () => {
    const ok = wrapNodes(
      [{ block: "core/group", attributes: { backgroundColor: "base", style: { spacing: { padding: "var:preset|spacing|50" } } } }],
      { colors: [{ slug: "base", color: "#000" }], spacing: [{ slug: "50", size: "1rem" }] },
    );
    expect(layer2b(parsed(ok))).toEqual([]);
  });
});
