// Per-output-context injection defenses (origin §6.4). Each transform/guard maps
// to ONE output context, because an escape that is correct for one context is
// wrong for another (a value safe in an HTML text node can still break a CSS
// comment header or a filesystem path). The highest-severity vectors here are
// PHP-RCE (handled by patterns.ts: data is never interpolated as code) and
// zip-slip (handled here: every slug is charset-validated before a path is built
// from it, and every entry path is re-checked for traversal).
//
// Note on division of labour:
//   - RichText / block `text` HTML-encoding lives in patterns.ts + the serializer
//     contract (untrusted strings are encoded before they reach an attribute).
//   - URL safe-scheme validation lives in blocks/attributes (isSafeUrl), reused by
//     patterns.ts.
//   - THIS module owns the two contexts the file-tree assembler introduces: the
//     style.css comment header and the zip entry path.
import { THEME_SLUG_RE } from "../ir/schema";

/** Raised when a value would escape its output context (header break, traversal). */
export class InjectionDefenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InjectionDefenseError";
  }
}

// Comment-close sequence that would end a style.css `/* ... */` header early.
const COMMENT_CLOSE = /\*\//g;
// C0 control characters + DEL: CR/LF would inject a second header line; the rest
// have no legitimate place in a header value.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Make a string safe to embed inside a `style.css` header comment block. Two
 * break-out vectors are neutralized: `*` + `/` (closes the comment early) and
 * CR / LF (injects a forged second header line such as `Version:`/`Template:`).
 * Both are stripped (not rejected) so a benign title with an incidental newline
 * still yields a valid theme; the security property is that the returned value
 * provably contains neither sequence.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(COMMENT_CLOSE, "").replace(CONTROL_CHARS, "");
}

/**
 * Assert a slug matches the canonical theme-slug charset before it is used to
 * build a filesystem/zip path. Reusing THEME_SLUG_RE (the IR's single source)
 * means a slug that validated as IR cannot later be rejected here, and a slug
 * that reaches path construction is provably free of `/`, `.`, `\`, and `..`.
 */
export function assertSafeSlug(slug: string, label: string): void {
  if (!THEME_SLUG_RE.test(slug)) {
    throw new InjectionDefenseError(
      `${label} '${slug}' is not a safe slug (lowercase alnum/hyphen, 2-40 chars) — refusing to build a path from it.`,
    );
  }
}

/**
 * Assert a relative zip entry path cannot traverse out of the archive root.
 * Belt-and-suspenders behind assertSafeSlug + literal prefixes: rejects absolute
 * paths, backslashes, and any `..` path segment. JSZip is additionally configured
 * (in zip.ts) so entries are written under literal prefixes only.
 */
export function assertSafeRelPath(path: string): void {
  if (path.length === 0) {
    throw new InjectionDefenseError("Empty zip entry path.");
  }
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw new InjectionDefenseError(`Zip entry path '${path}' is absolute — refusing.`);
  }
  if (path.includes("\\")) {
    throw new InjectionDefenseError(`Zip entry path '${path}' contains a backslash — refusing.`);
  }
  if (path.split("/").some((segment) => segment === "..")) {
    throw new InjectionDefenseError(`Zip entry path '${path}' contains a '..' traversal segment — refusing.`);
  }
}

/**
 * Build a zip entry path from a trusted literal prefix and a leaf segment,
 * re-validating the result for traversal. The leaf may itself be unsafe (it can
 * derive from a slug), so the path is checked AFTER construction.
 */
export function buildEntryPath(prefix: string, leaf: string): string {
  const path = `${prefix}/${leaf}`;
  assertSafeRelPath(path);
  return path;
}
