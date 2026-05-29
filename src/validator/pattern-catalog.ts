// The Track 2 pattern catalog as seen by the validator. Layer 2a uses it to (a)
// resolve a patternRef's slug to a known pattern and (b) check that each param's
// `kind` matches the pattern's declared slot kind.
//
// SINGLE SOURCE OF TRUTH: the catalog is now DERIVED from the back-filled
// docs/pattern-library/*/meta.json `slots` maps (U8/#8). Before U8 the slot names
// and kinds were hand-maintained here as a provisional stand-in; now the
// meta.json targeting back-fill exists, both this validator view and the
// assembler's substitution read the same declarations, so the two cannot drift.
// The param-`kind` discriminator remains the frozen-contract piece (a tokenRef
// slot must receive a tokenRef param, etc.); the slot→block-attribute targeting
// detail lives in meta.json and is consumed by src/assembler/patterns.ts.
import {
  getPatternMeta,
  PATTERN_SLUGS,
  patternSlotKinds,
  type ParamKind,
} from "../assembler/pattern-library";
import { type AllowedBlockName } from "../blocks/allowlist";

export type { ParamKind };

interface PatternCatalogEntry {
  region: string;
  validRegions: string[];
  blocksUsed: AllowedBlockName[];
  /** slotName → expected param kind (derived from meta.json `slots`). */
  paramSlots: Record<string, ParamKind>;
}

function buildCatalog(): Record<string, PatternCatalogEntry> {
  const catalog: Record<string, PatternCatalogEntry> = {};
  for (const slug of PATTERN_SLUGS) {
    const meta = getPatternMeta(slug);
    if (!meta) continue;
    catalog[slug] = {
      region: meta.region,
      validRegions: meta.validRegions,
      blocksUsed: meta.blocksUsed,
      paramSlots: patternSlotKinds(slug),
    };
  }
  return catalog;
}

export const PATTERN_CATALOG: Record<string, PatternCatalogEntry> = buildCatalog();

export function isKnownPattern(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PATTERN_CATALOG, name);
}

/** The declared kind for a pattern's slot, or undefined if the slot is not declared. */
export function getDeclaredSlotKind(pattern: string, slot: string): ParamKind | undefined {
  return PATTERN_CATALOG[pattern]?.paramSlots[slot];
}
