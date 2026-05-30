// Pattern-library metadata loader tests. The seed patterns live in
// docs/pattern-library/<slug>/{meta.json,pattern.html}; this loader reads the
// meta.json `slots` map (the back-filled targeting convention) and the raw blob.
// No DOM needed here — meta.json is plain JSON, blob loading is a file read; the
// block-parsing (which needs jsdom) lives in patterns.ts.
import { describe, expect, it } from "vitest";

import {
  PATTERN_SLUGS,
  getPatternMeta,
  loadPatternBlob,
  patternSlotKinds,
} from "./pattern-library";

describe("pattern-library metadata loader", () => {
  it("exposes the curated pattern slugs", () => {
    expect([...PATTERN_SLUGS].sort()).toEqual([
      "hero-cover",
      "hero-portfolio-dark",
      "query-loop-list",
      "site-footer",
    ]);
  });

  it("loads a back-filled slot map with kind + target for hero-cover", () => {
    const meta = getPatternMeta("hero-cover");
    expect(meta).toBeDefined();
    const heading = meta!.slots.headingText;
    expect(heading).toBeDefined();
    expect(heading!.kind).toBe("text");
    expect(heading!.target.blockPath).toEqual([0, 0, 0]);
    expect(heading!.target.attribute).toBe("content");
  });

  it("declares A-full slot coverage: content, tokens, AND structural/query knobs", () => {
    const hero = getPatternMeta("hero-cover")!;
    // content
    expect(hero.slots.headingText?.kind).toBe("text");
    expect(hero.slots.primaryButtonUrl?.kind).toBe("url");
    // tokens
    expect(hero.slots.overlayColor?.kind).toBe("tokenRef");
    // structural knob
    expect(hero.slots.dimRatio?.kind).toBe("scalar");

    const query = getPatternMeta("query-loop-list")!;
    expect(query.slots.perPage?.kind).toBe("scalar"); // query knob
    expect(query.slots.postTemplateColumns?.kind).toBe("scalar"); // layout knob

    const footer = getPatternMeta("site-footer")!;
    expect(footer.slots.social1Url?.kind).toBe("url"); // content
    expect(footer.slots.navigationOrientation?.kind).toBe("scalar"); // layout knob
    expect(footer.slots.socialLinksStyle?.kind).toBe("scalar"); // layout knob
  });

  it("exposes the hero inter-slot dimRatio↔image rule", () => {
    const hero = getPatternMeta("hero-cover")!;
    expect(hero.slotRules?.length).toBeGreaterThan(0);
    const rule = hero.slotRules!.find((r) => r.type === "dimRatioImageDependency");
    expect(rule).toBeDefined();
    expect(rule!.dimRatioSlot).toBe("dimRatio");
    expect(rule!.imageSlot).toBe("backgroundImage");
  });

  it("declares the footer navigation site-data dependency", () => {
    const footer = getPatternMeta("site-footer")!;
    expect(footer.siteData?.navigation?.length).toBeGreaterThan(0);
    expect(footer.siteData!.navigation![0]!.blockPath).toEqual([0, 0, 1, 1]);
  });

  it("reduces a pattern's slots to a slotName→kind map (the validator's view)", () => {
    const kinds = patternSlotKinds("hero-cover");
    expect(kinds.headingText).toBe("text");
    expect(kinds.overlayColor).toBe("tokenRef");
    expect(kinds.dimRatio).toBe("scalar");
  });

  it("loads the raw pattern.html blob for a slug", () => {
    const blob = loadPatternBlob("hero-cover");
    expect(blob).toContain("<!-- wp:cover");
    expect(blob).toContain("<!-- /wp:cover -->");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getPatternMeta("does-not-exist")).toBeUndefined();
  });
});
