import { describe, expect, it } from "vitest";

import {
  hasBlockDelimiter,
  hasPhpTag,
  hasUnsafeStyleHeader,
  hasUnsafeUrl,
  isInvalidThemeSlug,
  scanCandidate,
} from "../../src/orchestration/producer-guards";

describe("producer guards — the five §6.4 never-emit vectors (T3-U2)", () => {
  describe("URL vector (javascript:/data: and normalized evasions)", () => {
    it("flags javascript: and data: schemes", () => {
      expect(hasUnsafeUrl("javascript:alert(1)")).toBe(true);
      expect(hasUnsafeUrl("data:text/html,<script>")).toBe(true);
    });
    it("catches whitespace/control-char evasions in the scheme", () => {
      expect(hasUnsafeUrl("java\tscript:alert(1)")).toBe(true);
      expect(hasUnsafeUrl(" javascript:alert(1)")).toBe(true);
    });
    it("passes safe schemes and relative URLs", () => {
      expect(hasUnsafeUrl("https://example.com")).toBe(false);
      expect(hasUnsafeUrl("mailto:a@b.com")).toBe(false);
      expect(hasUnsafeUrl("/relative/path")).toBe(false);
    });
  });

  describe("PHP vector (<?php / <?= / ?> and the case/whitespace evasions)", () => {
    it("flags PHP open/close tags", () => {
      expect(hasPhpTag("<?php system($_GET[x]); ?>")).toBe(true);
      expect(hasPhpTag("trailing ?>")).toBe(true);
      expect(hasPhpTag("<?= $x")).toBe(true);
    });
    it("catches case + post-`<?` whitespace evasions (still valid PHP tags)", () => {
      expect(hasPhpTag("<?PHP")).toBe(true);
      expect(hasPhpTag("<?  php")).toBe(true);
      expect(hasPhpTag("<?\tphp")).toBe(true);
    });
    it("does NOT false-flag benign prose (the over-normalization trap)", () => {
      expect(hasPhpTag("A calm, minimal blog.")).toBe(false);
      // "? >" with a space is not a PHP close tag; "< ?" is not a PHP open tag.
      expect(hasPhpTag("Why pay more? > See our pricing.")).toBe(false);
      expect(hasPhpTag("Is 3 < 5 ? maybe")).toBe(false);
      expect(hasPhpTag("<?xml version")).toBe(false); // not a PHP tag
    });
  });

  describe("delimiter vector (the WordPress block-comment open `<!-- wp:`)", () => {
    it("flags a block-delimiter open and its closing-tag form", () => {
      expect(hasBlockDelimiter("<!-- wp:html -->")).toBe(true);
      expect(hasBlockDelimiter("<!-- /wp:paragraph -->")).toBe(true);
    });
    it("catches post-comment-open whitespace evasions", () => {
      expect(hasBlockDelimiter("<!--\twp:html")).toBe(true);
      expect(hasBlockDelimiter("<!--   wp:paragraph")).toBe(true);
    });
    it("does NOT false-flag prose or a non-wp HTML comment (no block can be forged)", () => {
      expect(hasBlockDelimiter("Welcome to my site")).toBe(false);
      expect(hasBlockDelimiter("Step 1 --> Step 2")).toBe(false); // bare --> forges nothing
      expect(hasBlockDelimiter("rated 4 stars <!-- highly recommend")).toBe(false); // no wp:
    });
  });

  describe("style.css header vector (*/ and CR/LF)", () => {
    it("flags comment-close and newline injection", () => {
      expect(hasUnsafeStyleHeader("My Theme */ body{}")).toBe(true);
      expect(hasUnsafeStyleHeader("Line1\r\nLine2")).toBe(true);
      expect(hasUnsafeStyleHeader("Line1\nVersion: 9")).toBe(true);
    });
    it("passes a normal title/description", () => {
      expect(hasUnsafeStyleHeader("A Dark Photography Blog")).toBe(false);
    });
  });

  describe("slug vector (path traversal / pattern violation)", () => {
    it("flags traversal and out-of-pattern slugs", () => {
      expect(isInvalidThemeSlug("../../wp-config")).toBe(true);
      expect(isInvalidThemeSlug("Has Spaces")).toBe(true);
      expect(isInvalidThemeSlug("UPPER")).toBe(true);
      expect(isInvalidThemeSlug("a")).toBe(true); // too short (min 2)
    });
    it("passes a conformant slug", () => {
      expect(isInvalidThemeSlug("dark-photo-blog")).toBe(false);
    });
  });

  describe("scanCandidate — applies each guard to its designated IR fields", () => {
    const base = {
      irVersion: 1,
      theme: { slug: "demo-theme", title: "Demo" },
      tokens: {},
      regions: [{ kind: "template", name: "index", content: [] }],
    };

    it("returns no violations for a clean candidate", () => {
      expect(scanCandidate(base)).toEqual([]);
    });

    it("flags a PHP tag smuggled into a paragraph text field", () => {
      const ir = structuredClone(base);
      ir.regions[0]!.content = [{ block: "core/paragraph", text: "hello <?php evil ?>" }] as never;
      const v = scanCandidate(ir);
      expect(v.some((x) => x.kind === "php")).toBe(true);
    });

    it("flags an unsafe URL in a core/button.url attribute", () => {
      const ir = structuredClone(base);
      ir.regions[0]!.content = [
        { block: "core/button", attributes: { url: "javascript:alert(1)" } },
      ] as never;
      expect(scanCandidate(ir).some((x) => x.kind === "url")).toBe(true);
    });

    it("flags a block delimiter inside a patternRef url/text param", () => {
      const ir = structuredClone(base);
      ir.regions[0]!.content = [
        { pattern: "hero-cover", params: { heading: { kind: "text", value: "<!-- wp:html -->" } } },
      ] as never;
      expect(scanCandidate(ir).some((x) => x.kind === "delimiter")).toBe(true);
    });

    it("flags a style.css-hostile theme title and an invalid theme slug", () => {
      const ir = structuredClone(base);
      ir.theme = { slug: "../bad", title: "Evil */ body{}" } as never;
      const v = scanCandidate(ir);
      expect(v.some((x) => x.kind === "css-header")).toBe(true);
      expect(v.some((x) => x.kind === "slug")).toBe(true);
    });

    it("flags an unsafe URL param of kind url", () => {
      const ir = structuredClone(base);
      ir.regions[0]!.content = [
        { pattern: "hero-cover", params: { primaryButtonUrl: { kind: "url", value: "data:text/html,x" } } },
      ] as never;
      expect(scanCandidate(ir).some((x) => x.kind === "url")).toBe(true);
    });
  });
});
