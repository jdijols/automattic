// style.css header-emission tests. WordPress identifies a theme by the metadata
// header in style.css; "Theme Name" is the only strictly-required field, but a
// production theme declares version + compatibility too. Every interpolated value
// is an untrusted string, so the header is the canonical place to prove the
// style.css injection defense (origin §6.4): a title or description can never
// break out of the `/* ... */` comment or forge an extra header line.
import { describe, expect, it } from "vitest";

import { buildStyleCss } from "./style-css";

const baseTheme = {
  slug: "aurora-blog",
  title: "Aurora",
  author: "Jane Doe",
  description: "Essays on craft.",
};

describe("buildStyleCss", () => {
  it("emits the required Theme Name header from the title", () => {
    expect(buildStyleCss(baseTheme)).toContain("Theme Name: Aurora");
  });

  it("derives the Text Domain from the (already-validated) slug", () => {
    expect(buildStyleCss(baseTheme)).toContain("Text Domain: aurora-blog");
  });

  it("declares the pinned WordPress + PHP compatibility floor", () => {
    const css = buildStyleCss(baseTheme);
    expect(css).toContain("Requires at least: 6.6");
    expect(css).toContain("Requires PHP: 8.2");
  });

  it("uses LF line endings and a single closing comment", () => {
    const css = buildStyleCss(baseTheme);
    expect(css).not.toContain("\r");
    expect(css.match(/\*\//g)).toHaveLength(1);
  });

  it("neutralizes a title that tries to close the comment early (style.css injection)", () => {
    const css = buildStyleCss({ ...baseTheme, title: "Evil */ body{display:none} /*" });
    // Exactly one comment-close survives — the real one we emit at the end.
    expect(css.match(/\*\//g)).toHaveLength(1);
    expect(css.trimEnd().endsWith("*/")).toBe(true);
  });

  it("neutralizes a description that tries to inject a forged Version header", () => {
    const css = buildStyleCss({ ...baseTheme, description: "Real\nVersion: 9.9.9" });
    // The injected line cannot create a second Version field.
    expect(css.match(/^Version:/gm)).toHaveLength(1);
  });

  it("omits the Author line entirely when no author is given (no empty field)", () => {
    const css = buildStyleCss({ slug: "aurora-blog", title: "Aurora" });
    expect(css).not.toMatch(/^Author:/m);
  });
});
