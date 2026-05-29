// style.css header emission (origin §6.1, §6.4). WordPress reads a theme's
// identity from the comment header at the top of style.css. Every value here that
// derives from user/AI input (title, author, description) flows through
// sanitizeHeaderValue first, so the header is structurally incapable of being
// broken out of — a malicious title cannot close the comment early, and a
// multi-line description cannot forge a second header field (e.g. a fake
// `Version:` or `Template:`). The slug is already charset-validated upstream
// (assertSafeSlug), so the Text Domain is safe by construction.
import { sanitizeHeaderValue } from "./escaping";

/** The theme metadata the header needs (a subset of the IR's `theme` object). */
export interface ThemeHeader {
  slug: string;
  title: string;
  author?: string;
  description?: string;
}

// Compatibility floor — pinned to the same WP/PHP the U10 Playground gate runs
// against, so what we declare is what we test on (origin: WP 6.6 / PHP 8.2).
const REQUIRES_WP = "6.6";
const TESTED_WP = "6.6";
const REQUIRES_PHP = "8.2";
const THEME_VERSION = "1.0.0";

/**
 * Build the style.css contents for a theme. Returns a deterministic, LF-terminated
 * string with exactly one comment block. Optional fields (Author) are omitted when
 * absent rather than emitted empty, so the header stays clean.
 */
export function buildStyleCss(theme: ThemeHeader): string {
  const lines: string[] = ["/*"];
  lines.push(`Theme Name: ${sanitizeHeaderValue(theme.title)}`);
  if (theme.author !== undefined && theme.author.length > 0) {
    lines.push(`Author: ${sanitizeHeaderValue(theme.author)}`);
  }
  if (theme.description !== undefined && theme.description.length > 0) {
    lines.push(`Description: ${sanitizeHeaderValue(theme.description)}`);
  }
  lines.push(`Version: ${THEME_VERSION}`);
  lines.push(`Requires at least: ${REQUIRES_WP}`);
  lines.push(`Tested up to: ${TESTED_WP}`);
  lines.push(`Requires PHP: ${REQUIRES_PHP}`);
  // The slug is charset-validated upstream (assertSafeSlug), but sanitize here
  // too so this function owns its header-safety claim rather than relying on call
  // order — a defense-in-depth no-op for a valid slug.
  lines.push(`Text Domain: ${sanitizeHeaderValue(theme.slug)}`);
  lines.push("*/");
  // Join with LF and end with a trailing newline (deterministic, byte-stable).
  return lines.join("\n") + "\n";
}
