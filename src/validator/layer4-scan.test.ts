// @vitest-environment jsdom
//
// Layer-4 assembled-artifact scan tests (origin §5.1 layer 4). This is the LAST
// line of defense for the disqualifying constraint: it scans the bytes that will
// actually ship — templates/*.html, parts/*.html, AND patterns/*.php — for a raw
// Custom HTML block, and re-parses each markup body to confirm every block name
// resolves to the allowlist. It runs on the assembled output, so it catches a
// raw delimiter no matter how it got there (a mutated pattern blob, a serializer
// regression, a hand-edited file) — defense the per-layer IR checks cannot give.
//
// The two invariants are fixed (origin): raw-wp:html-found (RAW_HTML_DETECTED) and
// unresolved-block-name (UNRESOLVED_BLOCK_NAME). These codes were declared in the
// frozen U4 enum; this layer adds none.
import { describe, expect, it } from "vitest";

import { scanAssembledArtifact } from "./layer4-scan";

describe("scanAssembledArtifact — clean artifact", () => {
  it("returns no errors for native block markup across all three file kinds", () => {
    const errors = scanAssembledArtifact([
      { path: "templates/index.html", content: `<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->` },
      { path: "parts/footer.html", content: `<!-- wp:site-title /-->` },
      {
        path: "patterns/site-footer.php",
        content: `<?php\n/**\n * Title: Footer\n * Slug: t/site-footer\n */\n?>\n<!-- wp:group --><div class="wp-block-group"></div><!-- /wp:group -->`,
      },
    ]);
    expect(errors).toEqual([]);
  });

  it("does not flag a neutralized wp:html *mention* inside an encoded text node", () => {
    // U6's neutralized fixtures render the delimiter as literal entity-encoded text;
    // there is no raw `<!-- wp:` byte sequence, so the scan must pass it.
    const errors = scanAssembledArtifact([
      {
        path: "templates/index.html",
        content: `<!-- wp:paragraph -->\n<p>Use the &lt;!-- wp:html --&gt; block? No.</p>\n<!-- /wp:paragraph -->`,
      },
    ]);
    expect(errors).toEqual([]);
  });
});

describe("scanAssembledArtifact — raw wp:html byte scan (RAW_HTML_DETECTED)", () => {
  it("catches a raw Custom HTML block in a template", () => {
    const errors = scanAssembledArtifact([
      { path: "templates/index.html", content: `<!-- wp:html -->\n<div>x</div>\n<!-- /wp:html -->` },
    ]);
    expect(errors.some((e) => e.code === "RAW_HTML_DETECTED")).toBe(true);
    expect(errors[0]?.invariant).toBe("wp-html");
    expect(errors[0]?.layer).toBe("assembled-artifact");
  });

  it("catches casing + whitespace evasion (<!--  WP:HTML  -->)", () => {
    const errors = scanAssembledArtifact([
      { path: "parts/footer.html", content: `<!--  WP:HTML  -->\n<div>x</div>\n<!--  /WP:HTML  -->` },
    ]);
    expect(errors.some((e) => e.code === "RAW_HTML_DETECTED")).toBe(true);
  });

  it("catches the fully-qualified wp:core/html delimiter inside a pattern PHP body", () => {
    const errors = scanAssembledArtifact([
      {
        path: "patterns/evil.php",
        content: `<?php /* Slug: t/evil */ ?>\n<!-- wp:core/html -->\n<div>x</div>\n<!-- /wp:core/html -->`,
      },
    ]);
    expect(errors.some((e) => e.code === "RAW_HTML_DETECTED")).toBe(true);
    expect(errors[0]?.path).toContain("patterns/evil.php");
  });
});

describe("scanAssembledArtifact — re-parse name resolution (UNRESOLVED_BLOCK_NAME)", () => {
  it("flags an undelimited HTML chunk that parses to core/missing", () => {
    const errors = scanAssembledArtifact([
      { path: "templates/index.html", content: `<p>undelimited content with no block wrapper</p>` },
    ]);
    expect(errors.some((e) => e.code === "UNRESOLVED_BLOCK_NAME")).toBe(true);
    expect(errors.find((e) => e.code === "UNRESOLVED_BLOCK_NAME")?.invariant).toBe(
      "hallucinated-block-name",
    );
  });

  it("flags a hallucinated block name not in the allowlist", () => {
    const errors = scanAssembledArtifact([
      { path: "templates/index.html", content: `<!-- wp:core/testimonial -->\n<div></div>\n<!-- /wp:core/testimonial -->` },
    ]);
    expect(errors.some((e) => e.code === "UNRESOLVED_BLOCK_NAME")).toBe(true);
  });

  it("accepts assembler-introduced blocks (core/page-list, core/pattern) that the IR cannot express", () => {
    const errors = scanAssembledArtifact([
      {
        path: "parts/footer.html",
        content: `<!-- wp:navigation -->\n<!-- wp:page-list /-->\n<!-- /wp:navigation -->`,
      },
      { path: "templates/index.html", content: `<!-- wp:pattern {"slug":"t/site-footer"} /-->` },
    ]);
    expect(errors).toEqual([]);
  });
});

describe("scanAssembledArtifact — file selection", () => {
  it("ignores non-scanned files (style.css, theme.json)", () => {
    const errors = scanAssembledArtifact([
      { path: "style.css", content: `/* Theme Name: <!-- wp:html --> */` },
      { path: "theme.json", content: `{"version":3}` },
    ]);
    expect(errors).toEqual([]);
  });
});
