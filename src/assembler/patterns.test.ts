// @vitest-environment jsdom
//
// Pattern-blob substitution tests (origin §6.2, §6.4 last row; U8). The
// patternRef path is the DEFAULT authoring mode, so it must inherit every defense
// the blockNode path has — not just text-encoding. These tests pin:
//   - structured (parse → mutate attributes → serialize), never string-replace;
//   - per-kind escaping (tokenRef slug / text HTML-encode / url safe-scheme /
//     scalar range-or-enum), keyed on the declared slot kind;
//   - normalized rejection of PHP + block-delimiter sequences for ALL kinds;
//   - the pre-substitution blob-integrity scan (raw wp:html / PHP in the blob);
//   - the hero dimRatio↔background-image inter-slot rule.
//
// Runs under jsdom: substitution parses + re-serializes via @wordpress/blocks.
import { describe, expect, it } from "vitest";

import type { PatternRef } from "../ir/types";
import { applyPattern, scanBlobIntegrity, substitutePattern } from "./patterns";
import { loadPatternBlob } from "./pattern-library";
import { wpParse } from "./wp-runtime";

/** Build a patternRef IR node tersely. */
function ref(pattern: string, params: PatternRef["params"]): PatternRef {
  return { pattern, nodeKind: "static", params } as PatternRef;
}

/** Assert the output contains no raw injection sequences and re-parses cleanly. */
function assertSafe(markup: string): void {
  expect(markup).not.toContain("<!-- wp:html");
  expect(markup.toLowerCase()).not.toContain("wp:html");
  expect(markup).not.toContain("<?php");
  expect(markup).not.toContain("<?=");
  expect(/<script\b/i.test(markup)).toBe(false);
  // Re-parse: no core/missing, no core/html, no core/freeform (the undelimited
  // / unknown buckets). A clean re-parse proves we did not corrupt the markup.
  const reparsed = wpParse(markup);
  const names = collectNames(reparsed);
  expect(names).not.toContain("core/html");
  expect(names).not.toContain("core/missing");
  expect(names).not.toContain("core/freeform");
}

function collectNames(blocks: ReturnType<typeof wpParse>): string[] {
  const out: string[] = [];
  const walk = (bs: ReturnType<typeof wpParse>): void => {
    for (const b of bs) {
      if (b.name) out.push(b.name);
      if (b.innerBlocks?.length) walk(b.innerBlocks);
    }
  };
  walk(blocks);
  return out;
}

describe("happy path — structured substitution", () => {
  it("substitutes content + token onto the right hero block attributes", () => {
    const out = substitutePattern(
      ref("hero-cover", {
        headingText: { kind: "text", value: "Build your portfolio" },
        overlayColor: { kind: "tokenRef", value: "primary" },
        primaryButtonLabel: { kind: "text", value: "Get started" },
        primaryButtonUrl: { kind: "url", value: "https://example.com/start" },
      }),
    );
    // Heading text landed in the h1.
    expect(out).toContain("Build your portfolio");
    // overlayColor token landed on the cover (serialize emits has-primary-*).
    expect(out).toContain("has-primary-background-color");
    // Button label + href landed.
    expect(out).toContain("Get started");
    expect(out).toContain('href="https://example.com/start"');
    assertSafe(out);
  });

  it("leaves un-targeted slots at their authored defaults", () => {
    const out = substitutePattern(ref("hero-cover", {}));
    // The authored default heading is preserved when no slot fills it.
    expect(out).toContain("Headline that names the visitor&#039;s goal".replace("&#039;", "'"));
    assertSafe(out);
  });

  it("substitutes query knobs onto the query/post-template config", () => {
    const out = substitutePattern(
      ref("query-loop-list", {
        perPage: { kind: "scalar", value: 9 },
        orderBy: { kind: "scalar", value: "title" },
        postTemplateColumns: { kind: "scalar", value: 4 },
      }),
    );
    expect(out).toContain('"perPage":9');
    expect(out).toContain('"orderBy":"title"');
    expect(out).toContain('"columnCount":4');
    assertSafe(out);
  });

  it("substitutes footer social URLs + layout knobs", () => {
    const out = substitutePattern(
      ref("site-footer", {
        social1Url: { kind: "url", value: "https://mastodon.example/@me" },
        navigationOrientation: { kind: "scalar", value: "horizontal" },
        socialLinksStyle: { kind: "scalar", value: "is-style-pill-shape" },
        copyrightText: { kind: "text", value: "© 2026 Studio" },
      }),
    );
    expect(out).toContain("https://mastodon.example/@me");
    expect(out).toContain('"orientation":"horizontal"');
    expect(out).toContain("is-style-pill-shape");
    expect(out).toContain("© 2026 Studio");
    assertSafe(out);
  });
});

describe("per-kind escaping — text", () => {
  it("HTML-entity-encodes a <script> text value (renders literal, not rejected)", () => {
    const out = substitutePattern(
      ref("hero-cover", {
        headingText: { kind: "text", value: 'Hi <script>alert(1)</script>' },
      }),
    );
    expect(out).toContain("&lt;script&gt;");
    assertSafe(out);
  });

  it("encodes ampersands and angle brackets in text", () => {
    const out = substitutePattern(
      ref("hero-cover", { paragraphText: { kind: "text", value: "A & B < C" } }),
    );
    expect(out).toContain("A &amp; B &lt; C");
    assertSafe(out);
  });
});

describe("per-kind escaping — url safe-scheme (the default-path XSS fix)", () => {
  it("rejects a javascript: URL param", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { primaryButtonUrl: { kind: "url", value: "javascript:alert(1)" } }),
      ),
    ).toThrowError(/scheme|unsafe|url/i);
  });

  it("rejects a data: URL param", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { primaryButtonUrl: { kind: "url", value: "data:text/html,<x>" } }),
      ),
    ).toThrowError(/scheme|unsafe|url/i);
  });

  it("accepts an https URL param", () => {
    const out = substitutePattern(
      ref("hero-cover", { primaryButtonUrl: { kind: "url", value: "https://ok.example" } }),
    );
    expect(out).toContain('href="https://ok.example"');
  });

  it("defeats whitespace/control obfuscation in a url param (java\\tscript:)", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { primaryButtonUrl: { kind: "url", value: "java\tscript:alert(1)" } }),
      ),
    ).toThrowError(/scheme|unsafe|url/i);
  });

  it("rejects a delimiter-bearing URL on a delimiter-STORED slot (social-link url)", () => {
    // core/social-link stores its url IN the block-delimiter JSON. A url carrying
    // a `<!--wp:html-->` sequence is rejected by the normalized forbidden-sequence
    // gate before substitution (and even if it weren't, serialize() Unicode-
    // escapes `<`/`>`/`-` in delimiter attributes — defense in depth).
    expect(() =>
      substitutePattern(
        ref("site-footer", { social1Url: { kind: "url", value: "https://x/--><!--wp:html-->" } }),
      ),
    ).toThrow();
  });

  it("keeps a delimiter-stored URL safe even when it ends with --> (no comment break)", () => {
    // `-->` alone is not a forbidden sequence (no `<!--wp:`), so this reaches the
    // serializer — which Unicode-escapes it inside the delimiter JSON, so the
    // output still re-parses to exactly the footer blocks (no core/html/missing).
    const out = substitutePattern(
      ref("site-footer", { social1Url: { kind: "url", value: "https://example.com/path-->" } }),
    );
    assertSafe(out);
  });
});

describe("delimiter + PHP rejection — ALL kinds, normalized", () => {
  it("rejects a text value containing a PHP open tag", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { headingText: { kind: "text", value: 'x <?php system("rm") ?>' } }),
      ),
    ).toThrowError(/php|delimiter|forbidden/i);
  });

  it("rejects a text value containing a raw block delimiter (canonical form)", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { headingText: { kind: "text", value: "x <!-- wp:html -->" } }),
      ),
    ).toThrowError(/delimiter|wp:|forbidden/i);
  });

  it("rejects a normalized block-delimiter evasion (<!--\\tWP:HTML)", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { headingText: { kind: "text", value: "x <!--\tWP:HTML -->" } }),
      ),
    ).toThrowError(/delimiter|wp:|forbidden/i);
  });

  it("rejects a no-space block-delimiter evasion (<!--wp:)", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { paragraphText: { kind: "text", value: "<!--wp:paragraph-->" } }),
      ),
    ).toThrowError(/delimiter|wp:|forbidden/i);
  });

  it("rejects a PHP close-tag evasion in a tokenRef-resolved value path (defense in depth)", () => {
    // A tokenRef value is normally a slug; an attempt to smuggle `?>` is rejected
    // before resolution, the same as any other kind.
    expect(() =>
      substitutePattern(
        ref("hero-cover", { overlayColor: { kind: "tokenRef", value: "primary?>" } }),
      ),
    ).toThrow();
  });
});

describe("tokenRef vocabulary resolution", () => {
  it("rejects a tokenRef value that is not a valid vocabulary slug", () => {
    expect(() =>
      substitutePattern(
        ref("hero-cover", { overlayColor: { kind: "tokenRef", value: "Not A Slug!" } }),
      ),
    ).toThrowError(/slug|token|vocab/i);
  });

  it("accepts a well-formed token slug", () => {
    const out = substitutePattern(
      ref("hero-cover", { overlayColor: { kind: "tokenRef", value: "contrast" } }),
    );
    expect(out).toContain("has-contrast-background-color");
  });
});

describe("scalar range + enum bounds", () => {
  it("rejects a scalar outside its numeric range (perPage 99 > max 24)", () => {
    expect(() =>
      substitutePattern(ref("query-loop-list", { perPage: { kind: "scalar", value: 99 } })),
    ).toThrowError(/range|bound|out of/i);
  });

  it("rejects a scalar outside its enum (orderBy 'random')", () => {
    expect(() =>
      substitutePattern(ref("query-loop-list", { orderBy: { kind: "scalar", value: "random" } })),
    ).toThrowError(/enum|allowed|bound/i);
  });

  it("accepts an in-range scalar and an in-enum scalar", () => {
    const out = substitutePattern(
      ref("query-loop-list", {
        perPage: { kind: "scalar", value: 12 },
        order: { kind: "scalar", value: "asc" },
      }),
    );
    expect(out).toContain('"perPage":12');
    expect(out).toContain('"order":"asc"');
  });
});

describe("unknown slot + kind mismatch", () => {
  it("rejects a param naming a slot the pattern does not declare", () => {
    expect(() =>
      substitutePattern(ref("hero-cover", { notARealSlot: { kind: "text", value: "x" } })),
    ).toThrowError(/unknown slot|not declared|no slot/i);
  });

  it("rejects a param whose kind disagrees with the declared slot kind", () => {
    expect(() =>
      // headingText is a text slot; sending a tokenRef must be rejected.
      substitutePattern(ref("hero-cover", { headingText: { kind: "tokenRef", value: "primary" } })),
    ).toThrowError(/kind|mismatch/i);
  });

  it("rejects a patternRef to an unknown pattern slug", () => {
    expect(() => substitutePattern(ref("no-such-pattern", {}))).toThrowError(/unknown pattern|not found/i);
  });
});

describe("hero dimRatio ↔ background-image inter-slot rule", () => {
  it("rejects dimRatio 60 when no background image is set (must be 100 for a solid hero)", () => {
    expect(() =>
      substitutePattern(ref("hero-cover", { dimRatio: { kind: "scalar", value: 60 } })),
    ).toThrowError(/dimRatio|image|legib|solid/i);
  });

  it("accepts dimRatio 100 with no background image", () => {
    const out = substitutePattern(ref("hero-cover", { dimRatio: { kind: "scalar", value: 100 } }));
    expect(out).toContain("has-background-dim-100");
  });

  it("accepts dimRatio 55 when a background image IS set", () => {
    const out = substitutePattern(
      ref("hero-cover", {
        backgroundImage: { kind: "url", value: "https://img.example/hero.jpg" },
        dimRatio: { kind: "scalar", value: 55 },
      }),
    );
    // The exact dimRatio rides in the block-delimiter JSON; WordPress rounds the
    // `has-background-dim-N` utility class to the nearest 10 for image covers
    // (so 55 → has-background-dim-60), while the attribute stays 55.
    expect(out).toContain('"dimRatio":55');
    expect(out).toContain('"url":"https://img.example/hero.jpg"');
    expect(out).toContain("wp-block-cover__image-background");
  });
});

describe("pre-substitution blob-integrity scan", () => {
  it("passes the clean seed blobs", () => {
    for (const slug of ["hero-cover", "query-loop-list", "site-footer"]) {
      expect(() => scanBlobIntegrity(loadPatternBlob(slug), slug)).not.toThrow();
    }
  });

  it("rejects a blob carrying a raw wp:html delimiter", () => {
    const tampered = '<!-- wp:html --><div>x</div><!-- /wp:html -->';
    expect(() => scanBlobIntegrity(tampered, "tampered")).toThrowError(/wp:html|integrity|blob/i);
  });

  it("rejects a blob carrying an embedded PHP tag (the pre-layer-4 gate)", () => {
    const tampered = '<!-- wp:paragraph --><p><?php echo 1; ?></p><!-- /wp:paragraph -->';
    expect(() => scanBlobIntegrity(tampered, "tampered")).toThrowError(/php|integrity|blob/i);
  });

  it("rejects a normalized wp:html evasion in the blob (<!--\\tWP:HTML)", () => {
    expect(() => scanBlobIntegrity("<!--\tWP:HTML -->", "tampered")).toThrowError(
      /wp:html|integrity|blob/i,
    );
  });

  it("substitutePattern runs the blob scan before substituting", () => {
    // applyPattern over a tampered blob string must reject regardless of params.
    const tampered = '<!-- wp:html -->x<!-- /wp:html -->';
    expect(() => applyPattern(tampered, getMetaStub(), {})).toThrowError(/wp:html|integrity|blob/i);
  });
});

// Minimal meta stub for the applyPattern-over-raw-blob test (no slots needed —
// the blob scan fires first).
function getMetaStub(): Parameters<typeof applyPattern>[1] {
  return {
    name: "tampered",
    title: "t",
    region: "x",
    validRegions: [],
    blocksUsed: [],
    slots: {},
  };
}
