// T3-U2 — producer-side never-emit guards (origin §6.2/§6.4). The five hostile
// output sequences Track 3 must not emit into IR string fields, checked on a
// generation candidate BEFORE it reaches the validator.
//
// These guards do NOT replace the validator — the Track-1 validator + the
// layer-4 byte scan are the authoritative, enforcing gate. The guards are a
// cheap producer-side awareness layer: they catch a steered model early so the
// T3-U4 retry loop does not burn budget on a value the validator will reject
// anyway.
//
// CRITICAL: the guards match the PRECISE hostile token (case- and internal-
// whitespace-tolerant where the token itself permits it), NOT a globally
// whitespace-collapsed haystack. Collapsing all whitespace would turn benign
// prose like "pay more? > see pricing" into "...more?>see..." and false-flag it
// as a PHP tag — which would make the retry loop reject valid content forever.
import { isSafeUrl, urlAttributesFor } from "../blocks/attributes";
import { THEME_SLUG_RE } from "../ir/schema";

// A WordPress block-comment delimiter open: `<!-- wp:` or the closing-tag form
// `<!-- /wp:`, whitespace-tolerant after the comment open. A bare `-->` or a
// non-wp HTML comment cannot forge a block, so they are intentionally not
// flagged (mirrors the layer-4 `wp:` delimiter scan; avoids prose false-flags).
const BLOCK_DELIMITER = /<!--\s*\/?wp:/i;
// A PHP open tag: `<?php`, `<?=`, the short tag `<?` followed by whitespace/EOL,
// or a `?>` close tag. `<?` must be adjacent (a space — "< ?" — is not a PHP
// tag), so prose with "? >" or "< 3" is not flagged.
const PHP_TAG = /<\?(php\b|=|\s|$)|\?>/i;
// A depth cap so a pathological / cyclic `innerBlocks` chain is bounded, not a
// stack overflow. Above the contract MAX_DEPTH (10) so it never trips on valid IR.
const MAX_SCAN_DEPTH = 12;

/** Vector 1 — URL-valued field with a dangerous scheme (`javascript:`/`data:`/…). */
export function hasUnsafeUrl(value: string): boolean {
  return !isSafeUrl(value);
}

/** Vector 2 — a raw PHP open/close tag (`<?php`, `<?=`, `<?`, `?>`). */
export function hasPhpTag(value: string): boolean {
  return PHP_TAG.test(value);
}

/** Vector 3 — a WordPress block-comment delimiter (`<!-- wp:` / `<!-- /wp:`). */
export function hasBlockDelimiter(value: string): boolean {
  return BLOCK_DELIMITER.test(value);
}

/**
 * Vector 4 — a value hostile to the `style.css` header comment: a CSS
 * comment-close sequence breaks out of the header block, and CR/LF enables
 * header injection. Checked RAW (the literal bytes are what land in style.css).
 */
export function hasUnsafeStyleHeader(value: string): boolean {
  return value.includes("*/") || /[\r\n]/.test(value);
}

/** Vector 5 — a slug that escapes the frozen theme-slug pattern (path traversal). */
export function isInvalidThemeSlug(value: string): boolean {
  return !THEME_SLUG_RE.test(value);
}

export type ProducerGuardKind = "url" | "php" | "delimiter" | "css-header" | "slug";

export interface ProducerGuardViolation {
  kind: ProducerGuardKind;
  /** Root-to-field path, e.g. "regions[0].content[1].attributes.url". */
  path: string;
  message: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Walk a generation candidate and apply each §6.4 guard to its designated IR
 * string fields. Defensive against the permissive generation-view shape (content
 * nodes are `unknown`) and against pathological depth. Returns every violation;
 * an empty array means clean.
 */
export function scanCandidate(ir: unknown): ProducerGuardViolation[] {
  const out: ProducerGuardViolation[] = [];
  if (!isRecord(ir)) return out;

  // "Any string → PHP body" applies to every produced string field.
  const php = (value: string, path: string): void => {
    if (hasPhpTag(value)) out.push({ kind: "php", path, message: `PHP tag in ${path}.` });
  };

  const theme = ir.theme;
  if (isRecord(theme)) {
    if (typeof theme.slug === "string") {
      php(theme.slug, "theme.slug");
      if (isInvalidThemeSlug(theme.slug)) {
        out.push({ kind: "slug", path: "theme.slug", message: `Slug '${theme.slug}' violates the theme-slug pattern.` });
      }
    }
    for (const key of ["title", "author", "description"] as const) {
      const value = theme[key];
      if (typeof value === "string") {
        php(value, `theme.${key}`);
        if (hasUnsafeStyleHeader(value)) {
          out.push({ kind: "css-header", path: `theme.${key}`, message: `style.css-hostile sequence in theme.${key}.` });
        }
      }
    }
  }

  const regions = ir.regions;
  if (Array.isArray(regions)) {
    regions.forEach((region, ri) => {
      const content = isRecord(region) ? region.content : undefined;
      if (Array.isArray(content)) {
        content.forEach((node, ni) => walkNode(node, `regions[${ri}].content[${ni}]`, out, php, 0));
      }
    });
  }
  return out;
}

function walkNode(
  node: unknown,
  path: string,
  out: ProducerGuardViolation[],
  php: (value: string, path: string) => void,
  depth: number,
): void {
  if (!isRecord(node) || depth > MAX_SCAN_DEPTH) return;

  // Scan text + attributes on ANY node shape (not gated on a string `block`), so
  // a malformed candidate's strings are still checked rather than silently skipped.
  if (typeof node.text === "string") php(node.text, `${path}.text`);

  const attrs = node.attributes;
  if (isRecord(attrs)) {
    const urlKeys = typeof node.block === "string" ? urlAttributesFor(node.block) : [];
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value !== "string") continue;
      php(value, `${path}.attributes.${key}`);
      if (urlKeys.includes(key) && hasUnsafeUrl(value)) {
        out.push({ kind: "url", path: `${path}.attributes.${key}`, message: `Unsafe URL scheme in ${path}.attributes.${key}.` });
      }
    }
  }

  // patternRef params slot map (text/url/tokenRef/scalar).
  if (isRecord(node.params)) {
    for (const [slot, param] of Object.entries(node.params)) {
      if (!isRecord(param) || typeof param.value !== "string") continue;
      const p = `${path}.params.${slot}`;
      php(param.value, p);
      if (hasBlockDelimiter(param.value)) {
        out.push({ kind: "delimiter", path: p, message: `Block-comment delimiter in ${p}.` });
      }
      if (param.kind === "url" && hasUnsafeUrl(param.value)) {
        out.push({ kind: "url", path: p, message: `Unsafe URL scheme in ${p}.` });
      }
    }
  }

  if (Array.isArray(node.innerBlocks)) {
    node.innerBlocks.forEach((child, i) => walkNode(child, `${path}.innerBlocks[${i}]`, out, php, depth + 1));
  }
}
