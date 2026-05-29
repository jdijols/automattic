// Single source of truth for detecting a raw Custom HTML block delimiter — the
// disqualifying constraint. TWO defenses depend on agreeing exactly on what
// "normalized" means and which delimiter forms count: the U8 pre-substitution
// blob-integrity scan (patterns.ts) and the U9 post-assembly layer-4 byte scan
// (layer4-scan.ts). If those two ever disagreed, an evasion that slips one would
// be missed by the other — so the normalization rule and the delimiter list live
// here once and are imported by both.
//
// Normalization strips ALL whitespace and Unicode control/format characters and
// case-folds, so every evasion (`<!--  WP:HTML  -->`, `<!--\twp:core/html`, a
// zero-width-joiner spliced into the delimiter) collapses onto the same needle.

/** Whitespace + Unicode control/format characters stripped before matching. */
export const SCAN_STRIP = /[\s\p{Cc}\p{Cf}]/gu;

/** Normalize a string for delimiter detection: drop whitespace/controls, case-fold. */
export function normalizeForScan(value: string): string {
  return value.replace(SCAN_STRIP, "").toLowerCase();
}

/**
 * The Custom HTML block delimiter, normalized, in both its short and
 * fully-qualified forms. Targeting the DELIMITER (`<!--wp:html`) rather than a
 * bare `wp:html` substring avoids false-positives on prose that merely mentions
 * the block, while still catching the structural smuggling form.
 */
export const RAW_HTML_DELIMITERS = ["<!--wp:html", "<!--wp:core/html"] as const;

/** True if a string, once normalized, contains a raw Custom HTML block delimiter. */
export function containsRawHtmlDelimiter(value: string): boolean {
  const normalized = normalizeForScan(value);
  return RAW_HTML_DELIMITERS.some((needle) => normalized.includes(needle));
}
