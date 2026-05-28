import { describe, expect, it } from "vitest";

import heroMeta from "../../docs/pattern-library/hero-cover/meta.json";
import queryMeta from "../../docs/pattern-library/query-loop-list/meta.json";
import footerMeta from "../../docs/pattern-library/site-footer/meta.json";
import { ALLOWLIST, isAllowedBlock } from "./allowlist";

describe("allowlist", () => {
  it("is a closed set of unique block names", () => {
    expect(new Set(ALLOWLIST).size).toBe(ALLOWLIST.length);
    // The MVP surface is the origin §4.1 union (~30 blocks).
    expect(ALLOWLIST.length).toBe(32);
  });

  it("admits every block the 3 seed patterns use (drift guard)", () => {
    const used = [
      ...heroMeta.blocksUsed,
      ...queryMeta.blocksUsed,
      ...footerMeta.blocksUsed,
    ];
    for (const block of used) {
      expect(
        isAllowedBlock(block),
        `seed pattern uses ${block} but it is not in the allowlist`,
      ).toBe(true);
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
