import { describe, expect, it } from "vitest";

import { getPatternMeta, PATTERN_SLUGS } from "../assembler/pattern-library";
import { ALLOWLIST, isAllowedBlock } from "./allowlist";

describe("allowlist", () => {
  it("is a closed set of unique block names", () => {
    expect(new Set(ALLOWLIST).size).toBe(ALLOWLIST.length);
    // The MVP surface is the origin §4.1 union, plus core/media-text (admitted
    // for the dark editorial hero). Expansion is a deliberate, reviewed PR.
    expect(ALLOWLIST.length).toBe(33);
  });

  it("admits every block every catalog pattern uses (drift guard)", () => {
    for (const slug of PATTERN_SLUGS) {
      const meta = getPatternMeta(slug);
      expect(meta, `missing meta.json for pattern ${slug}`).toBeDefined();
      for (const block of meta!.blocksUsed) {
        expect(
          isAllowedBlock(block),
          `pattern ${slug} uses ${block} but it is not in the allowlist`,
        ).toBe(true);
      }
    }
  });

  it("accepts real, in-set block names", () => {
    expect(isAllowedBlock("core/group")).toBe(true);
    expect(isAllowedBlock("core/query")).toBe(true);
    expect(isAllowedBlock("core/social-link")).toBe(true);
  });

  it("rejects hallucinated block names", () => {
    expect(isAllowedBlock("core/hero-section")).toBe(false);
    expect(isAllowedBlock("core/scroll-spy")).toBe(false);
    expect(isAllowedBlock("core/testimonial")).toBe(false);
  });

  it("never admits the disqualifying or escape-hatch blocks", () => {
    expect(isAllowedBlock("core/html")).toBe(false);
    expect(isAllowedBlock("core/shortcode")).toBe(false);
    expect(isAllowedBlock("core/freeform")).toBe(false);
  });

  it("never admits third-party namespaces", () => {
    expect(isAllowedBlock("acme/widget")).toBe(false);
    expect(isAllowedBlock("jetpack/contact-form")).toBe(false);
  });
});
