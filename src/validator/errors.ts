// The structured error format (origin §5.2) — a Track 1 deliverable consumed by
// TWO parties: Track 3 (the orchestrator parses code/path/hint to build a retry
// re-prompt) and Track 4 (the UI renders message to the persona). It must carry
// both machine structure and human-legible text; a bare boolean or a raw AJV/Zod
// error dump fails both consumers. Raw validator internals are NEVER included
// (origin §8.3).
//
// The `code` enum spans ALL FOUR layers and is WHOLE at the U7 freeze — layer-3
// (U5) and layer-4 (U9) codes are declared here even though their producers land
// later, so the frozen contract does not silently gain codes in Phase B. The
// layer-4 codes are mechanically derivable from its two fixed invariants
// (raw-wp:html-found, unresolved-block-name), so the complete set is knowable
// now, not guessed.

/** Which validation layer produced the error (origin §5.1 fixed order). */
export type ValidationLayer = "schema" | "block-tree" | "theme-json" | "assembled-artifact";

/** Tags the three release-blocking invariant classes; null when not applicable. */
export type Invariant =
  | "wp-html"
  | "hallucinated-block-name"
  | "invalid-theme-json"
  | null;

export const ERROR_CODES = [
  // Layer 1 — schema (this unit)
  "MALFORMED_INPUT",
  "SCHEMA_VALIDATION",
  "DEPTH_BOUND_EXCEEDED",
  "NODE_COUNT_EXCEEDED",
  // Layer 2a — block-tree, per node (this unit)
  "BLOCK_NOT_ALLOWED",
  "BLOCK_CONTAINMENT",
  "ATTRIBUTE_UNKNOWN",
  "ATTRIBUTE_OUT_OF_RANGE",
  "ATTRIBUTE_UNSAFE_URL",
  "QUERY_CONFIG_INVALID",
  "PATTERN_NOT_FOUND",
  "PATTERN_PARAM_KIND_MISMATCH",
  // Layer 2b — post-composition (this unit)
  "MULTIPLE_H1",
  "HEADING_OUTLINE",
  "REGION_NOT_UNIQUE",
  "DANGLING_TOKEN_REFERENCE",
  // Layer 3 — theme.json (implemented in U5)
  "THEME_JSON_INVALID",
  "TOKEN_VALUE_INVALID",
  // Layer 4 — assembled-artifact (implemented in U9)
  "RAW_HTML_DETECTED",
  "UNRESOLVED_BLOCK_NAME",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const MAX_HINT_LENGTH = 200;

/** The frozen field set (Q4). `invariant` is nullable; `hint` is optional & bounded. */
export interface ValidationError {
  code: ErrorCode;
  layer: ValidationLayer;
  /** Root-to-node path, e.g. "templates/index.html › core/query › core/scroll-spy". */
  path: string;
  /** Human-legible message for Track 4. Never a raw Zod/AJV internal. */
  message: string;
  /** Tags an invariant class when applicable; null otherwise. */
  invariant: Invariant;
  /** Optional retry-oriented hint for Track 3; capped, no schema fragments. */
  hint?: string;
}

/** The validator's result: a typed artifact, or a structured error list — never a silent pass. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

interface ErrorInput {
  code: ErrorCode;
  layer: ValidationLayer;
  path: string;
  message: string;
  invariant?: Invariant;
  hint?: string;
}

/** Construct a ValidationError, enforcing the frozen field-set bounds. */
export function makeError(input: ErrorInput): ValidationError {
  const error: ValidationError = {
    code: input.code,
    layer: input.layer,
    path: input.path,
    message: input.message,
    invariant: input.invariant ?? null,
  };
  if (input.hint !== undefined) {
    // Cap the hint and strip newlines so it can never carry a schema fragment.
    error.hint = input.hint.replace(/\s+/g, " ").trim().slice(0, MAX_HINT_LENGTH);
  }
  return error;
}
