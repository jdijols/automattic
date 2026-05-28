// The typed IR contract (origin §2.4) — the schema `generateObject` consumes and
// the §5 validator enforces. Three load-bearing properties make a Custom HTML
// *block* structurally impossible to express rather than merely discouraged:
//   1. additionalProperties:false everywhere (z.strictObject) — no invented
//      node-level `rawHtml`/`customCss`/`shortcode` key can appear.
//   2. `block` is the U2 allowlist enum, NOT a free string — `core/html` is
//      absent, and a hallucinated name fails at the schema layer.
//   3. `node` is a strict-armed union with exactly-one-match semantics — an
//      object carrying both a `block` and a `pattern` key matches neither arm
//      and is rejected deterministically (never silently coerced). The arms'
//      required keys (`block` vs `pattern`) are disjoint; KEEP them disjoint at
//      the U7 freeze, or the JSON-Schema `anyOf` emission would stop rejecting
//      ambiguous objects.
//
// Scope of the guarantee (do NOT overstate it downstream): this is structural at
// the NODE level. `attributes` is deliberately an open bag (rich-text values
// like a paragraph's `content` legitimately contain inline HTML), so the IR
// schema alone does NOT sanitize attribute *values*. The no-raw-HTML and
// no-XSS invariants for attribute content are enforced downstream — U2/U4
// per-block attribute validation + U8 per-context escaping + the U4 layer-4
// byte scan of assembled output. The IR layer guarantees "no wp:html block,"
// not "no HTML anywhere."
//
// Resource-exhaustion precondition: `irSchema.safeParse` fully parses the
// recursive tree BEFORE the depth/count superRefine runs, so a pathologically
// deep `innerBlocks` chain (~1k+ levels) can throw a RangeError out of
// safeParse rather than returning a clean rejection. The superRefine is a
// correctness backstop for moderate over-nesting only. Untrusted input MUST
// first pass U4's layer-1 raw-JSON pre-walk (which uses MAX_DEPTH /
// MAX_TOTAL_NODES below and short-circuits without descending) — that is the
// real DoS guard, not this schema.
//
// The recursive `blockNode.innerBlocks → node` core cannot be enforced by
// provider constrained-decoding (recursion + depth limits), so under Q7 Option C
// it arrives as best-effort JSON and this schema (+ the U4 pre-walk) is the
// authority. See docs/phase-2-prd.md §3.
import * as z from "zod";

import { ALLOWLIST } from "../blocks/allowlist";

// Structural bounds (origin §2.4 #4 — resource-exhaustion, not correctness).
// Exported so U4's layer-1 raw pre-walk uses the same numbers as the contract.
export const MAX_INNER_BLOCKS = 32;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_DEPTH = 10;
export const MAX_TOTAL_NODES = 2000;

const themeSlug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "slug must be lowercase alphanumeric/hyphen, 2-40 chars");

// Preset/token slugs may start with a digit (e.g. the spacing slug "50").
const tokenSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

// --- design tokens (definitions → theme.json; values validated in U5/layer-3) ---

const colorToken = z.strictObject({
  slug: tokenSlug,
  name: z.string().max(60).optional(),
  color: z.string().max(120),
});

const sizeToken = z.strictObject({
  slug: tokenSlug,
  name: z.string().max(60).optional(),
  size: z.string().max(60),
});

export const designTokensSchema = z.strictObject({
  colors: z.array(colorToken).max(48).optional(),
  fontSizes: z.array(sizeToken).max(24).optional(),
  spacing: z.array(sizeToken).max(24).optional(),
});

// --- typed query sub-object (origin §2.4; IR-notes #7) ---
// The `query` attribute of core/query is a bounded enum/int surface, not free
// content. U4 layer-2a applies this to a core/query node's attributes.query.
export const querySchema = z.strictObject({
  perPage: z.number().int().min(1).max(100).optional(),
  orderBy: z.enum(["date", "title", "menu_order", "rand"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  postType: z.enum(["post", "page"]).optional(),
  inherit: z.boolean().optional(),
});

// --- patternRef.params: a typed, category-tagged slot map (frozen contract) ---
// The `kind` discriminator lets U4 validate params and U8 apply the correct
// per-slot escape (tokenRef → slug, text → HTML-encode, url → safe-scheme,
// scalar → range-check). Only the slot→attribute targeting convention is left
// to Track 2 (Open Questions).
export const paramSlotSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tokenRef"), value: z.string().max(120) }),
  z.strictObject({ kind: z.literal("text"), value: z.string().max(MAX_TEXT_LENGTH) }),
  z.strictObject({ kind: z.literal("url"), value: z.string().max(MAX_TEXT_LENGTH) }),
  z.strictObject({
    kind: z.literal("scalar"),
    value: z.union([z.number(), z.string().max(120), z.boolean()]),
  }),
]);

// Explicit node-kind (origin §2.4 sub-surfaces; IR-notes #1): `static` renders
// once, `template-region` renders per-item (query/comment loops). Optional with
// a `static` default so authored-once subtrees stay terse.
const nodeKind = z.enum(["static", "template-region"]).default("static");

// --- the recursive node (Zod 4 getter-based recursion) ---

export const blockNodeSchema = z.strictObject({
  block: z.enum(ALLOWLIST),
  nodeKind,
  // Per-block attribute schema is applied in validation layer 2 (U2/U4); here it
  // is an open object so the recursive shape stays provider-agnostic.
  attributes: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  get innerBlocks() {
    return z.array(nodeSchema).max(MAX_INNER_BLOCKS).optional();
  },
});

export const patternRefSchema = z.strictObject({
  pattern: themeSlug, // existence checked vs the Track 2 catalog in U4 layer-2a
  nodeKind,
  params: z.record(z.string(), paramSlotSchema).optional(),
});

// Strict-armed union → exactly-one-match. An object with both `block` and
// `pattern` keys (or a near-arm with an extra key) matches neither strict arm.
export const nodeSchema = z.union([blockNodeSchema, patternRefSchema]);

const regionSchema = z.strictObject({
  kind: z.enum(["template", "part"]),
  name: z.enum(["index", "single", "archive", "page", "home", "404", "header", "footer"]),
  content: z.array(nodeSchema),
});

// The structural envelope, without the depth/count walk — JSON Schema is emitted
// from this (the walk is a check JSON Schema cannot express; U4 enforces it on
// raw JSON before parsing, the real resource-exhaustion guard).
export const irStructuralSchema = z.strictObject({
  irVersion: z.literal(1),
  theme: z.strictObject({
    slug: themeSlug,
    title: z.string().min(1).max(120),
    author: z.string().max(120).optional(),
    description: z.string().max(280).optional(),
    wpVersionTarget: z.literal("6.6").default("6.6"),
  }),
  tokens: designTokensSchema,
  regions: z.array(regionSchema).min(1),
});

/**
 * Walk the parsed content trees and return the max depth and total node count.
 * A region-root node is depth 1; its innerBlocks are depth 2; etc.
 */
function measure(nodes: readonly unknown[], depth: number): { maxDepth: number; count: number } {
  let maxDepth = depth - 1;
  let count = 0;
  for (const node of nodes) {
    count += 1;
    maxDepth = Math.max(maxDepth, depth);
    const inner = (node as { innerBlocks?: unknown[] }).innerBlocks;
    if (Array.isArray(inner) && inner.length > 0) {
      const child = measure(inner, depth + 1);
      maxDepth = Math.max(maxDepth, child.maxDepth);
      count += child.count;
    }
  }
  return { maxDepth, count };
}

/** The runtime validator: structural schema + depth/count bounds. */
export const irSchema = irStructuralSchema.superRefine((ir, ctx) => {
  let total = 0;
  for (const region of ir.regions) {
    const { maxDepth, count } = measure(region.content, 1);
    total += count;
    if (maxDepth > MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `Block tree exceeds the maximum nesting depth of ${MAX_DEPTH} (found ${maxDepth}).`,
        path: ["regions"],
      });
    }
  }
  if (total > MAX_TOTAL_NODES) {
    ctx.addIssue({
      code: "custom",
      message: `IR exceeds the maximum total node count of ${MAX_TOTAL_NODES} (found ${total}).`,
      path: ["regions"],
    });
  }
});

export type IR = z.infer<typeof irStructuralSchema>;
export type IRNode = z.infer<typeof nodeSchema>;
export type BlockNode = z.infer<typeof blockNodeSchema>;
export type PatternRef = z.infer<typeof patternRefSchema>;
export type Region = z.infer<typeof regionSchema>;
export type DesignTokens = z.infer<typeof designTokensSchema>;
export type ParamSlot = z.infer<typeof paramSlotSchema>;
export type QueryConfig = z.infer<typeof querySchema>;
