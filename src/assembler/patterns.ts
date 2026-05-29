// patternRef → canonical WordPress markup via STRUCTURED, category-based
// substitution (origin §6.2, §6.4 last row; U8). The patternRef path is the
// DEFAULT authoring mode for covered regions, so it must inherit every defense
// the free-tree blockNode path has — this module treats every param value as
// hostile (the no-Custom-HTML constraint's primary injection surface).
//
// THE SUBSTITUTION IS STRUCTURED, NEVER A STRING REPLACE. We `parse()` the blob
// into a block tree, walk to the slot's target block by `blockPath`, escape the
// value per its declared `kind`, set it on the block's attribute, and re-
// `serialize()`. A string replace into the blob would reopen exactly the
// injection surface the whole backbone exists to close. Because mutated values
// go through Gutenberg's own attribute encoding (JSON in the delimiter) and we
// HTML-encode RichText values ourselves before assignment, a param can never
// break out into a new block delimiter or a raw HTML tag.
//
// Why we re-derive the markup instead of preserving the authored blob bytes: a
// parse→serialize round-trip of a pattern blob is NOT byte-identical (serialize
// re-runs each block's save()). That is fine and intended — serialize() IS the
// canonical-bytes authority (origin §6.2, Q6; same authority as serializer.ts),
// the blob is a structural template, and the locked nesting is preserved by
// construction (we only touch attributes, never the tree shape).
//
// Defense layers, in order:
//   1. Pre-substitution blob-integrity scan — the RAW blob body must contain no
//      raw wp:html / PHP delimiters (the earlier gate before U9's layer-4 scan,
//      which only sees the assembled artifact). Seed blobs are trusted-by-
//      assumption; a mutated/compromised blob is caught here.
//   2. Per-param validation keyed on the declared slot kind:
//        tokenRef → must be a vocabulary slug (no escaping needed once validated)
//        text     → HTML-entity-encoded (renders literal)
//        url      → the U2 safe-scheme allowlist (rejects javascript:/data:)
//        scalar   → range- or enum-checked per the slot's declared bounds
//   3. ALL kinds → reject PHP delimiters (`<?`, `?>`, `<?php`, `<?=`) and block-
//      delimiter sequences (`<!-- wp:`), matched NORMALIZED (whitespace-stripped,
//      case-folded) so `<!--wp:` / `<!--\tWP:HTML` evasions fall the same way.
//   4. Inter-slot rules (IR-notes #8): the hero dimRatio↔background-image rule.
import { isSafeUrl } from "../blocks/attributes";
import type { PatternRef } from "../ir/types";
import {
  getPatternMeta,
  loadPatternBlob,
  type PatternMeta,
  type ScalarBounds,
  type SlotDeclaration,
} from "./pattern-library";
import { wpParse, wpSerialize, type BlockInstance } from "./wp-runtime";

/** Raised when a param value or blob fails a substitution-time safety/bounds check. */
export class PatternSubstitutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternSubstitutionError";
  }
}

// --- normalization + forbidden-sequence detection (shared by params + blob) ---

/** Whitespace + control/format characters stripped before sequence matching. */
const STRIP = /[\s\p{Cc}\p{Cf}]/gu;

/** Normalize for sequence detection: drop whitespace/controls, case-fold. */
function normalize(value: string): string {
  return value.replace(STRIP, "").toLowerCase();
}

// Forbidden substrings, matched against the NORMALIZED string. PHP delimiters are
// the RCE vector (patterns become require'd patterns/*.php); block-delimiter
// sequences are the wp:html / structure-smuggling vector.
const FORBIDDEN_NORMALIZED = [
  "<?php",
  "<?=",
  "<?",
  "?>",
  "<!--wp:", // any block-delimiter open (covers wp:html and structure smuggling)
  "wp:html", // the disqualifying block name, even without a full delimiter
] as const;

/**
 * Reject a string that, once normalized, contains a PHP delimiter or a block-
 * delimiter sequence. Applied to EVERY param value (all kinds) and used by the
 * blob-integrity scan. `where` names the source for the error message.
 */
function assertNoForbiddenSequences(value: string, where: string): void {
  const norm = normalize(value);
  for (const needle of FORBIDDEN_NORMALIZED) {
    if (norm.includes(needle)) {
      throw new PatternSubstitutionError(
        `${where} contains a forbidden sequence ('${needle}' after normalization) — PHP/block delimiters are never permitted.`,
      );
    }
  }
}

// --- pre-substitution blob-integrity scan ---

/**
 * Scan a raw pattern blob body for raw wp:html / PHP delimiters BEFORE any
 * substitution (origin §6.4 security note). The seed blobs are trusted, but a
 * mutated or compromised blob carrying an embedded `<?php` would reach the
 * assembled `patterns/*.php` before U9's post-assembly layer-4 scan — so this is
 * the earlier gate. Pair with a committed SHA-256 manifest (see
 * pattern-manifest.ts) asserted in CI so a modified blob in a PR is visible.
 */
export function scanBlobIntegrity(blob: string, slug: string): void {
  const norm = normalize(blob);
  // The blob legitimately contains `<!--wp:` for every real block, so we cannot
  // reject that wholesale. We reject the disqualifying Custom HTML block in both
  // the short (`<!-- wp:html`) and fully-qualified (`<!-- wp:core/html`) delimiter
  // forms — matching U9's layer-4 scan intent — plus PHP delimiters, which a valid
  // native blob never contains. Targeting the DELIMITER form (not a bare `wp:html`
  // substring) avoids false-positives on legitimate prose that mentions the block.
  for (const needle of ["<!--wp:html", "<!--wp:core/html"] as const) {
    if (norm.includes(needle)) {
      throw new PatternSubstitutionError(
        `Pattern blob '${slug}' failed the integrity scan: contains a raw wp:html block delimiter.`,
      );
    }
  }
  for (const needle of ["<?php", "<?=", "?>"] as const) {
    if (norm.includes(needle)) {
      throw new PatternSubstitutionError(
        `Pattern blob '${slug}' failed the integrity scan: contains a PHP delimiter ('${needle}').`,
      );
    }
  }
}

// --- per-kind value preparation (returns the value to assign onto the block) ---

const TOKEN_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function prepareText(value: unknown, slot: string): string {
  if (typeof value !== "string") {
    throw new PatternSubstitutionError(`Slot '${slot}' (text) requires a string value.`);
  }
  assertNoForbiddenSequences(value, `Slot '${slot}'`);
  return escapeHtml(value);
}

function prepareTokenRef(value: unknown, slot: string): string {
  if (typeof value !== "string") {
    throw new PatternSubstitutionError(`Slot '${slot}' (tokenRef) requires a string value.`);
  }
  assertNoForbiddenSequences(value, `Slot '${slot}'`);
  if (!TOKEN_SLUG.test(value)) {
    throw new PatternSubstitutionError(
      `Slot '${slot}' (tokenRef) value '${value}' is not a valid token vocabulary slug.`,
    );
  }
  return value;
}

function prepareUrl(value: unknown, slot: string): string {
  if (typeof value !== "string") {
    throw new PatternSubstitutionError(`Slot '${slot}' (url) requires a string value.`);
  }
  assertNoForbiddenSequences(value, `Slot '${slot}'`);
  if (!isSafeUrl(value)) {
    throw new PatternSubstitutionError(
      `Slot '${slot}' (url) value '${value}' uses a disallowed URL scheme (only http/https/mailto/tel).`,
    );
  }
  return value;
}

function prepareScalar(value: unknown, slot: string, bounds: ScalarBounds | undefined): unknown {
  // Strings still get the forbidden-sequence check (enum scalars are strings).
  if (typeof value === "string") {
    assertNoForbiddenSequences(value, `Slot '${slot}'`);
  }
  if (bounds?.enum) {
    if (!bounds.enum.includes(value as string | number)) {
      throw new PatternSubstitutionError(
        `Slot '${slot}' (scalar) value ${JSON.stringify(value)} is not one of the allowed enum values [${bounds.enum.join(", ")}].`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (bounds?.min !== undefined && value < bounds.min) {
      throw new PatternSubstitutionError(
        `Slot '${slot}' (scalar) value ${value} is below the minimum ${bounds.min}.`,
      );
    }
    if (bounds?.max !== undefined && value > bounds.max) {
      throw new PatternSubstitutionError(
        `Slot '${slot}' (scalar) value ${value} is above the maximum ${bounds.max} (out of range).`,
      );
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  throw new PatternSubstitutionError(
    `Slot '${slot}' (scalar) value ${JSON.stringify(value)} is not a number, boolean, or allowed enum value.`,
  );
}

/** Validate + transform a param value to the value to assign onto its block attribute. */
function prepareValue(slot: string, decl: SlotDeclaration, value: unknown): unknown {
  switch (decl.kind) {
    case "text":
      return prepareText(value, slot);
    case "tokenRef":
      return prepareTokenRef(value, slot);
    case "url":
      return prepareUrl(value, slot);
    case "scalar":
      return prepareScalar(value, slot, decl.bounds);
  }
}

// --- block-tree navigation + attribute assignment ---

/** Resolve a blockPath to a block instance within the parsed top-level array. */
function resolveBlock(top: BlockInstance[], blockPath: number[], slot: string): BlockInstance {
  if (blockPath.length === 0) {
    throw new PatternSubstitutionError(`Slot '${slot}' has an empty blockPath.`);
  }
  const [head, ...rest] = blockPath;
  let node: BlockInstance | undefined = top[head as number];
  if (!node) {
    throw new PatternSubstitutionError(
      `Slot '${slot}' blockPath [${blockPath.join(",")}] does not resolve (no top-level block at index ${head}).`,
    );
  }
  for (const index of rest) {
    const next: BlockInstance | undefined = node.innerBlocks?.[index];
    if (!next) {
      throw new PatternSubstitutionError(
        `Slot '${slot}' blockPath [${blockPath.join(",")}] does not resolve (no inner block at index ${index}).`,
      );
    }
    node = next;
  }
  return node;
}

/** Set a (possibly dotted) attribute path on a block's attributes object, immutably-ish per level. */
function setAttribute(block: BlockInstance, attribute: string, value: unknown): void {
  const parts = attribute.split(".");
  const attrs = block.attributes as Record<string, unknown>;
  let cursor = attrs;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] as string;
    const existing = cursor[key];
    if (existing === undefined || existing === null || typeof existing !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

// --- inter-slot rules ---

/**
 * Enforce the hero dimRatio↔background-image rule (IR-notes #8). With an image,
 * dimRatio must darken-for-legibility; with no image, it must be full opacity or
 * the solid color renders washed-out. The applicable range comes from the
 * pattern's `slotRules`, so the rule is data-driven, not hard-coded here.
 */
function enforceSlotRules(meta: PatternMeta, params: NonNullable<PatternRef["params"]>): void {
  for (const rule of meta.slotRules ?? []) {
    if (rule.type !== "dimRatioImageDependency") continue;
    const dim = params[rule.dimRatioSlot];
    if (!dim || dim.kind !== "scalar" || typeof dim.value !== "number") continue;
    const hasImage = params[rule.imageSlot] !== undefined;
    const range = hasImage ? rule.withImage : rule.withoutImage;
    if (dim.value < range.min || dim.value > range.max) {
      throw new PatternSubstitutionError(
        hasImage
          ? `dimRatio ${dim.value} is outside the legible range ${range.min}-${range.max} for a hero WITH a background image.`
          : `dimRatio ${dim.value} is invalid for a solid (no-image) hero — it must be ${range.min}-${range.max} or the overlay renders washed-out. Set a backgroundImage slot to use a lower dimRatio.`,
      );
    }
  }
}

// --- the public substitution entry points ---

/**
 * Apply a validated param map to a pre-parsed-and-scanned pattern. Lower-level
 * entry used by tests and by substitutePattern; assumes the blob has already
 * passed scanBlobIntegrity (it re-runs the scan defensively when given a raw
 * blob string).
 */
export function applyPattern(
  blob: string,
  meta: PatternMeta,
  params: PatternRef["params"],
): string {
  // Defense: re-scan the raw blob even on this lower-level path.
  scanBlobIntegrity(blob, meta.name);

  const resolvedParams = params ?? {};

  // Reject unknown slots and kind mismatches up front (mirrors the layer-2a
  // PATTERN_PARAM_KIND_MISMATCH / unknown-slot checks; defense in depth at
  // assembly even though the validator should have caught them).
  for (const [slot, param] of Object.entries(resolvedParams)) {
    const decl = meta.slots[slot];
    if (!decl) {
      throw new PatternSubstitutionError(
        `Pattern '${meta.name}' has no slot named '${slot}' (unknown slot / not declared).`,
      );
    }
    if (decl.kind !== param.kind) {
      throw new PatternSubstitutionError(
        `Slot '${slot}' expects kind '${decl.kind}' but received '${param.kind}' (kind mismatch).`,
      );
    }
  }

  // Inter-slot rules run against the raw params (before per-value transform) so
  // they can reason about which slots are present.
  enforceSlotRules(meta, resolvedParams);

  const top = wpParse(blob);

  for (const [slot, param] of Object.entries(resolvedParams)) {
    const decl = meta.slots[slot]!;
    const prepared = prepareValue(slot, decl, param.value);
    const block = resolveBlock(top, decl.target.blockPath, slot);
    setAttribute(block, decl.target.attribute, prepared);
  }

  const output = wpSerialize(top);
  // Final belt-and-suspenders at the injection surface: the substituted markup
  // must never contain a raw Custom HTML block delimiter. Per-kind escaping +
  // Gutenberg's delimiter encoding already prevent this, but the hard constraint
  // is release-blocking, so we enforce it at this boundary too (not only at U9's
  // post-assembly layer-4 scan). Match the delimiter form, normalized.
  const normOut = normalize(output);
  if (normOut.includes("<!--wp:html") || normOut.includes("<!--wp:core/html")) {
    throw new PatternSubstitutionError(
      `Substituted output for pattern '${meta.name}' contains a raw wp:html block delimiter — refusing to emit.`,
    );
  }
  return output;
}

/**
 * Resolve a patternRef IR node to canonical WordPress markup. Loads the seed
 * blob + meta, runs the blob-integrity scan, applies category-based substitution
 * with per-kind escaping, and serializes. Throws PatternSubstitutionError on any
 * unsafe value, bounds violation, unknown slot/pattern, or kind mismatch.
 */
export function substitutePattern(node: PatternRef): string {
  const meta = getPatternMeta(node.pattern);
  if (!meta) {
    throw new PatternSubstitutionError(`Unknown pattern '${node.pattern}' (not found in the catalog).`);
  }
  const blob = loadPatternBlob(node.pattern);
  return applyPattern(blob, meta, node.params);
}
