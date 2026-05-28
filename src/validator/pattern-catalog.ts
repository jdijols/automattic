// The Track 2 pattern catalog as seen by the validator. Layer 2a uses it to (a)
// resolve a patternRef's slug to a known pattern and (b) check that each param's
// `kind` matches the pattern's declared slot kind.
//
// SCOPE NOTE: the param slot KINDS below are the frozen-contract piece (a
// tokenRef slot must receive a tokenRef param, etc.) and mirror each seed
// pattern's `parameterizable` categories in docs/pattern-library/*/meta.json.
// The slot NAMES are provisional — the slot→block-attribute TARGETING convention
// (where in pattern.html each slot writes) is U8/#8's back-fill and is NOT
// decided here. Undeclared slots are permitted in Phase A (not yet constrained);
// U8 fully validates slots against the back-filled meta.json.
import { type AllowedBlockName } from "../blocks/allowlist";

export type ParamKind = "tokenRef" | "text" | "url" | "scalar";

interface PatternCatalogEntry {
  region: string;
  validRegions: string[];
  blocksUsed: AllowedBlockName[];
  /** slotName → expected param kind. */
  paramSlots: Record<string, ParamKind>;
}

export const PATTERN_CATALOG: Record<string, PatternCatalogEntry> = {
  "hero-cover": {
    region: "hero",
    validRegions: ["hero", "page-top"],
    blocksUsed: [
      "core/cover",
      "core/group",
      "core/heading",
      "core/paragraph",
      "core/buttons",
      "core/button",
    ],
    paramSlots: {
      heading: "text",
      paragraph: "text",
      primaryButtonText: "text",
      primaryButtonUrl: "url",
      secondaryButtonText: "text",
      secondaryButtonUrl: "url",
      overlayColor: "tokenRef",
      textColor: "tokenRef",
      buttonBackgroundColor: "tokenRef",
      backgroundImage: "url",
      dimRatio: "scalar",
      minHeight: "scalar",
    },
  },
  "query-loop-list": {
    region: "content",
    validRegions: ["content", "home-feed", "archive-feed"],
    blocksUsed: [
      "core/group",
      "core/heading",
      "core/query",
      "core/post-template",
      "core/post-featured-image",
      "core/post-title",
      "core/post-date",
      "core/post-excerpt",
      "core/query-pagination",
      "core/query-pagination-previous",
      "core/query-pagination-numbers",
      "core/query-pagination-next",
    ],
    paramSlots: {
      sectionHeading: "text",
      backgroundColor: "tokenRef",
      perPage: "scalar",
      postType: "scalar",
    },
  },
  "site-footer": {
    region: "footer",
    validRegions: ["footer"],
    blocksUsed: [
      "core/group",
      "core/columns",
      "core/column",
      "core/site-title",
      "core/paragraph",
      "core/heading",
      "core/navigation",
      "core/social-links",
      "core/social-link",
    ],
    paramSlots: {
      tagline: "text",
      copyright: "text",
      backgroundColor: "tokenRef",
      textColor: "tokenRef",
    },
  },
};

export function isKnownPattern(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PATTERN_CATALOG, name);
}

/** The declared kind for a pattern's slot, or undefined if the slot is not declared. */
export function getDeclaredSlotKind(pattern: string, slot: string): ParamKind | undefined {
  return PATTERN_CATALOG[pattern]?.paramSlots[slot];
}
