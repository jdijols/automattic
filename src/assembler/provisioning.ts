// Site-data provisioning (origin §6.5; IR-notes #5). A freshly-installed theme
// has no `wp_navigation` menu entities, so a `core/navigation` block that
// references one (or has no content at all) renders EMPTY — failing U10's
// "navigation renders non-empty" assertion and shipping a broken footer.
//
// The fix is to rewrite every navigation into PAGE-LIST FALLBACK MODE: drop the
// stored-menu `ref` and guarantee a `core/page-list` child, which renders the
// site's published pages with no database menu required.
//
// Why this operates on MARKUP, not the IR tree (doc-review: adversarial — P1):
// the most common navigation does NOT arrive as an IR node. The site-footer seed
// pattern carries its navigation INSIDE its pre-serialized blob, where the
// assembler only ever sees the resolved markup string. A provisioning rule that
// fired "only when the IR contains a core/navigation node" would silently skip
// that footer and ship an empty nav. Operating on assembled markup makes the
// pass blob-aware and IR-node-aware with one mechanism: it sees every navigation
// regardless of whether it originated as a free-tree node or inside a pattern.
//
// Byte-safety: a parse→serialize round-trip of canonical markup is a fixed point
// (verified — serialize() is the canonical-bytes authority, U8), so re-emitting a
// provisioned subtree does not perturb the surrounding canonical bytes. As an
// extra guard we skip the round-trip entirely when no navigation is present, so
// nav-free templates are returned byte-for-byte unchanged.
import { wpCreateBlock, wpParse, wpSerialize, type BlockInstance } from "./wp-runtime";

const NAVIGATION = "core/navigation";
const PAGE_LIST = "core/page-list";

/**
 * Rewrite a single navigation instance to page-list fallback mode, in place.
 * Returns true if it changed anything (so the caller knows a re-serialize is
 * warranted). `ref` is always dropped; a page-list child is added only when the
 * navigation would otherwise render empty (no inner content of its own).
 */
function provisionNavigation(block: BlockInstance): boolean {
  let changed = false;
  const attrs = block.attributes as Record<string, unknown>;
  if ("ref" in attrs) {
    delete attrs.ref;
    changed = true;
  }
  // Add a page-list child only when the navigation would otherwise render empty.
  // If it already has authored inner items, those render non-empty on their own,
  // so we leave them untouched and do not force a page-list on top.
  const inner = block.innerBlocks ?? [];
  if (inner.length === 0) {
    block.innerBlocks = [wpCreateBlock(PAGE_LIST)];
    changed = true;
  }
  return changed;
}

/** Recursively provision every navigation in a block array; returns whether any changed. */
function provisionTree(blocks: BlockInstance[]): boolean {
  let changed = false;
  for (const block of blocks) {
    if (block.name === NAVIGATION) {
      if (provisionNavigation(block)) changed = true;
    }
    if (block.innerBlocks?.length) {
      if (provisionTree(block.innerBlocks)) changed = true;
    }
  }
  return changed;
}

/**
 * Provision every `core/navigation` in a markup string to page-list fallback
 * mode. Blob-aware AND IR-node-aware: it sees navigation that originated inside a
 * resolved pattern blob and navigation serialized from a free-tree node alike.
 * Returns the markup unchanged (byte-for-byte) when it contains no navigation.
 */
export function provisionNavigationMarkup(markup: string): string {
  // Cheap pre-check: a markup string with no navigation delimiter cannot need
  // provisioning, so skip the parse/serialize round-trip and return it verbatim.
  // Core blocks serialize with the short `wp:navigation` delimiter; the
  // fully-qualified `wp:core/navigation` form is matched too for completeness.
  if (!/wp:(core\/)?navigation\b/.test(markup)) return markup;
  const blocks = wpParse(markup);
  const changed = provisionTree(blocks);
  if (!changed) return markup;
  return wpSerialize(blocks);
}
