// Pattern-library metadata + blob loader. The seed patterns live under
// docs/pattern-library/<slug>/ as a `pattern.html` blob + a `meta.json`
// descriptor. The descriptor's `slots` map is the U8 back-fill: the
// slot→{block,attribute} TARGETING convention left open after U7 (the contract
// froze the param `kind` discriminator; the targeting was a deferred Track 2
// detail — see the plan's Open Questions). This module is the single source of
// truth for that mapping; both the assembler (patterns.ts substitution) and the
// validator (pattern-catalog.ts slot-kind checks) read from here, so they cannot
// drift.
//
// DOM-free by design: it only reads JSON + raw text. Parsing the blob into a
// block tree (which needs the WordPress DOM runtime) is patterns.ts's job — so
// the validator/orchestration, which import the catalog, never pull in jsdom.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type AllowedBlockName } from "../blocks/allowlist";

export type ParamKind = "tokenRef" | "text" | "url" | "scalar";

/** A scalar slot's accepted-value bounds: a numeric range or a closed enum. */
export interface ScalarBounds {
  min?: number;
  max?: number;
  enum?: ReadonlyArray<string | number>;
}

/** A tokenRef slot's vocabulary (which token family the slug must resolve in). */
export type TokenVocab = "color" | "fontSize" | "spacing";

export interface SlotTarget {
  /**
   * Path of inner-block indices from the pattern's top-level block array to the
   * target block. The first index selects the top-level block (patterns may have
   * more than one — e.g. the footer's group + copyright paragraph).
   */
  blockPath: number[];
  /**
   * The attribute to set on the target block. Dotted paths address nested
   * attributes (`query.perPage`, `layout.columnCount`, `style.border.radius`).
   */
  attribute: string;
}

export interface SlotDeclaration {
  kind: ParamKind;
  target: SlotTarget;
  bounds?: ScalarBounds & { vocab?: TokenVocab };
}

/** An inter-slot constraint (IR-notes #8): a slot's valid range depends on another slot. */
export interface SlotRule {
  type: "dimRatioImageDependency";
  dimRatioSlot: string;
  imageSlot: string;
  withImage: { min: number; max: number };
  withoutImage: { min: number; max: number };
}

/** A site-data dependency the assembler must provision (origin §6.5; IR-notes #5). */
export interface SiteDataDependency {
  blockPath: number[];
  fallback: string;
}

export interface PatternMeta {
  name: string;
  title: string;
  region: string;
  validRegions: string[];
  blocksUsed: AllowedBlockName[];
  slots: Record<string, SlotDeclaration>;
  slotRules?: SlotRule[];
  siteData?: { navigation?: SiteDataDependency[] };
}

/** The three seed patterns. Expansion is a deliberate Track 2 PR, never runtime. */
export const PATTERN_SLUGS = ["hero-cover", "query-loop-list", "site-footer"] as const;
export type PatternSlug = (typeof PATTERN_SLUGS)[number];

// Resolve the repo's docs/pattern-library dir relative to this module
// (src/assembler/ → ../../docs/pattern-library). Stable across cwd.
const PATTERN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "pattern-library");

const metaCache = new Map<string, PatternMeta>();
const blobCache = new Map<string, string>();

function isKnownSlug(slug: string): slug is PatternSlug {
  return (PATTERN_SLUGS as readonly string[]).includes(slug);
}

/** Load and cache a pattern's meta.json, or undefined if the slug is unknown. */
export function getPatternMeta(slug: string): PatternMeta | undefined {
  if (!isKnownSlug(slug)) return undefined;
  const cached = metaCache.get(slug);
  if (cached) return cached;
  const raw = readFileSync(join(PATTERN_DIR, slug, "meta.json"), "utf8");
  const meta = JSON.parse(raw) as PatternMeta;
  if (!meta.slots || typeof meta.slots !== "object") meta.slots = {};
  metaCache.set(slug, meta);
  return meta;
}

/** Load and cache a pattern's raw pattern.html blob. Throws if the slug is unknown. */
export function loadPatternBlob(slug: string): string {
  if (!isKnownSlug(slug)) {
    throw new Error(`Unknown pattern slug '${slug}'.`);
  }
  const cached = blobCache.get(slug);
  if (cached !== undefined) return cached;
  const blob = readFileSync(join(PATTERN_DIR, slug, "pattern.html"), "utf8");
  blobCache.set(slug, blob);
  return blob;
}

/**
 * The slotName→kind map for a pattern (empty for an unknown slug). This is the
 * validator's view of a pattern's slots — it checks a param's declared `kind`
 * against this without needing the targeting detail.
 */
export function patternSlotKinds(slug: string): Record<string, ParamKind> {
  const meta = getPatternMeta(slug);
  if (!meta) return {};
  const out: Record<string, ParamKind> = {};
  for (const [name, decl] of Object.entries(meta.slots)) {
    out[name] = decl.kind;
  }
  return out;
}
