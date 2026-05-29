// T3-U4 — turn a §5.2 validator error list into a correction suffix for the
// next generation attempt (origin §5.1 trust-the-parser loop).
//
// Built ONLY from the published error contract: the closed `code` enum (→ a
// fixed, deterministic correction phrase), the `path`, and the bounded `hint`.
// The validator's `message` is for Track 4's UI and is NOT re-injected; raw
// AJV/Zod internals never appear (origin §8.3) — the §5.2 errors are already
// clean, and this builder never dumps the raw error object.
//
// SECURITY (the hint-injection path): `path` and `hint` are USER-DATA-DERIVED —
// a dangling-token error's hint can echo a user-supplied token name like
// `var:preset|color|<!-- wp:html`. They are HTML-encoded before injection so a
// crafted fragment appears NORMALIZED, never verbatim, and cannot forge a block
// delimiter / PHP tag inside the re-prompt. The validator catches any resulting
// bad emission regardless — this only closes the inject-into-prompt lever.
import { type ErrorCode, type ValidationError } from "../validator";

import { htmlEncode } from "./prompt";

// Deterministic per-code correction copy. Branching on the CLOSED enum keeps the
// re-prompt stable and free of validator internals.
const CODE_GUIDANCE: Record<ErrorCode, string> = {
  MALFORMED_INPUT: "Return one valid JSON IR object only — no prose, no code fences.",
  SCHEMA_VALIDATION: "A field does not match the IR schema; correct it to conform.",
  DEPTH_BOUND_EXCEEDED: "The block tree is nested too deeply; flatten the structure.",
  NODE_COUNT_EXCEEDED: "There are too many blocks; reduce the total node count.",
  BLOCK_NOT_ALLOWED: "This block is not available; use an allowlisted block or a pattern reference.",
  BLOCK_CONTAINMENT: "This block is in an illegal parent; place it inside its required container.",
  ATTRIBUTE_UNKNOWN: "Remove this unknown attribute; it is not part of the block's schema.",
  ATTRIBUTE_OUT_OF_RANGE: "This attribute value is out of range; use a value within the allowed bounds.",
  ATTRIBUTE_UNSAFE_URL: "Use only http, https, mailto, or tel URLs here.",
  QUERY_CONFIG_INVALID: "Fix the core/query configuration to the allowed enum/integer bounds.",
  PATTERN_NOT_FOUND: "Use a pattern slug that exists in the catalog.",
  PATTERN_PARAM_KIND_MISMATCH: "A pattern parameter's kind is wrong; match the declared slot kind.",
  MULTIPLE_H1: "Use exactly one level-1 heading on the page.",
  HEADING_OUTLINE: "Fix the heading outline so levels do not skip.",
  REGION_NOT_UNIQUE: "Remove the duplicate singleton region.",
  DANGLING_TOKEN_REFERENCE:
    "This token is not defined; reference a core token (base, contrast, primary, secondary) or declare it in tokens.",
  THEME_JSON_INVALID: "The design tokens produce an invalid theme.json; correct the token definitions.",
  TOKEN_VALUE_INVALID: "A token value is unsafe or malformed; use a plain hex color or a valid size.",
  RAW_HTML_DETECTED: "Remove the raw HTML/wp:html; express everything with native blocks.",
  UNRESOLVED_BLOCK_NAME: "Use an allowlisted block name.",
};

const PATTERN_ONLY_INSTRUCTION =
  "On this attempt, build the page ONLY from catalog pattern references (by slug, with typed params); do not hand-build block trees.";

export interface RepromptOptions {
  /** Final-attempt pattern-only fallback (origin §3.5 / Q12). */
  patternOnly?: boolean;
}

/**
 * Build the correction suffix from the FULL current error list (anti-oscillation
 * — every retry sees every outstanding issue, not just the first).
 */
export function buildReprompt(errors: readonly ValidationError[], options: RepromptOptions = {}): string {
  // The validator never returns an ok:false with zero errors; guard anyway so a
  // defensive caller never produces a header that promises issues with none below.
  if (errors.length === 0) {
    const fallback = options.patternOnly ? `\n\n${PATTERN_ONLY_INSTRUCTION}` : "";
    return `The previous output failed validation. Re-emit a complete, schema-valid IR object.${fallback}`;
  }

  const lines = errors.map((error) => {
    const guidance = CODE_GUIDANCE[error.code];
    const at = error.path ? ` (at ${htmlEncode(error.path)})` : "";
    const hint = error.hint ? ` ${htmlEncode(error.hint)}` : "";
    return `- ${error.code}${at}: ${guidance}${hint}`;
  });

  const fallback = options.patternOnly ? `\n\n${PATTERN_ONLY_INSTRUCTION}` : "";
  return `The previous output failed validation. Fix EVERY issue below, then re-emit the COMPLETE IR object:\n${lines.join("\n")}${fallback}`;
}
