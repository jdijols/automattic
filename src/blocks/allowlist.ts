// The block-name allowlist — the single source of truth for which core blocks
// the generator may emit. This is the heart of the hallucinated-block invariant
// (origin §4.1): WordPress's serialization parser accepts ANY well-formed block
// name (real or invented) and surfaces unknowns only as `core/missing` at render
// time, so the allowlist is ours to own and enforce.
//
// The set is closed: expansion is a deliberate PR, never a runtime fallback.
// Explicitly excluded (origin §4.1): `core/html` (the disqualifying Custom HTML
// block — never admitted under any flag), `core/shortcode` (arbitrary-PHP escape
// hatch), `core/freeform` (classic-editor raw HTML), and every third-party
// namespace (not guaranteed present in vanilla WordPress).
//
// U3 compiles this list into the IR schema's `block` enum, keeping the two in
// lockstep. It must stay reconciled with the pattern library's `blocksUsed`
// (the drift guard in allowlist.test.ts).
export const ALLOWLIST = [
  // Layout / structure
  "core/group",
  "core/columns",
  "core/column",
  "core/cover",
  "core/spacer",
  "core/separator",
  "core/buttons",
  "core/button",
  // Content leaves
  "core/paragraph",
  "core/heading",
  "core/image",
  "core/media-text",
  "core/list",
  "core/list-item",
  "core/quote",
  // Site / FSE blocks
  "core/site-title",
  "core/site-logo",
  "core/site-tagline",
  "core/navigation",
  "core/social-links",
  "core/social-link",
  "core/template-part",
  // Query loop family
  "core/query",
  "core/post-template",
  "core/post-title",
  "core/post-featured-image",
  "core/post-excerpt",
  "core/post-date",
  "core/query-pagination",
  "core/query-pagination-previous",
  "core/query-pagination-numbers",
  "core/query-pagination-next",
  "core/query-no-results",
] as const;

export type AllowedBlockName = (typeof ALLOWLIST)[number];

const ALLOWED = new Set<string>(ALLOWLIST);

/** Narrowing membership check against the closed allowlist. */
export function isAllowedBlock(name: string): name is AllowedBlockName {
  return ALLOWED.has(name);
}
