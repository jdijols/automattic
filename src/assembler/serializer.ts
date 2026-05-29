// blockNode → canonical WordPress block markup (origin §6.2, Q6).
//
// Design decision (load-bearing): the serializer DELEGATES to `@wordpress/blocks`
// `serialize()` rather than re-implementing each block's `save()`. The plan names
// `serialize()` as the *parity oracle* and the canonical-bytes authority ("its
// save() defines the canonical attribute-JSON form", U9 golden file). Re-deriving
// every block's save() markup by hand (the `wp-block-cover__background` span, the
// `has-*` utility classes, the RichText wrappers) would be re-implementing
// Gutenberg — fragile and guaranteed to drift from the bytes WordPress actually
// expects. So "trust the parser, not the prompt" extends to serialization: we
// emit exactly what Gutenberg's own save() emits. The `@wordpress/blocks` version
// is exact-pinned (package.json) precisely because it defines these bytes; U9's
// golden-zip test asserts the resolved version so a lockfile bump that would
// change canonical bytes fails loudly.
//
// Scope: this path serializes only the small free-tree gap-filler set (uncovered
// regions). Covered regions arrive as pre-serialized pattern blobs and are
// handled by patterns.ts (substitution, not per-attribute serialization).
//
// IMPORTANT: `serialize()` does NOT escape RichText/HTML attributes (e.g. a
// heading's `content`). Callers that place untrusted strings into such attributes
// MUST escape them first — see patterns.ts. This module assumes its `blockNode`
// input has already passed the validator (attributes within the allowlist overlay).
import type { BlockNode, IRNode } from "../ir/types";
import { wpCreateBlock, wpSerialize, type BlockInstance } from "./wp-runtime";

/** Narrow an IR node to a blockNode (vs a patternRef). */
function isBlockNode(node: IRNode): node is BlockNode {
  return "block" in node;
}

/**
 * Build a `@wordpress/blocks` BlockInstance from an IR blockNode, recursively.
 * `text` (the IR's generic text field) is mapped onto the block's RichText
 * attribute when no explicit `attributes.content`/`attributes.text` is present:
 * heading/paragraph/etc. store their text under `content`. We only set it when
 * `text` is provided so we never clobber an explicit attribute.
 */
export function createWpBlock(node: BlockNode): BlockInstance {
  const attributes: Record<string, unknown> = { ...(node.attributes ?? {}) };
  if (node.text !== undefined && attributes.content === undefined && attributes.text === undefined) {
    attributes.content = node.text;
  }
  const inner = (node.innerBlocks ?? []).filter(isBlockNode).map(createWpBlock);
  return wpCreateBlock(node.block, attributes, inner);
}

/**
 * Serialize a single IR blockNode to canonical WordPress markup, byte-identical
 * to `@wordpress/blocks` `serialize()`. Throws if handed a patternRef (those go
 * through patterns.ts).
 */
export function serializeBlockNode(node: IRNode): string {
  if (!isBlockNode(node)) {
    throw new TypeError(
      "serializeBlockNode received a patternRef; pattern nodes are serialized by patterns.ts.",
    );
  }
  return wpSerialize(createWpBlock(node));
}

/**
 * Serialize an array of region-content blockNodes to a single markup string,
 * joined exactly as `serialize()` joins a block array (double newline between
 * top-level blocks). patternRef nodes are rejected — the assembler (U9) resolves
 * those via patterns.ts before composing region content.
 */
export function serializeNodes(nodes: readonly IRNode[]): string {
  const instances = nodes.map((node) => {
    if (!isBlockNode(node)) {
      throw new TypeError(
        "serializeNodes received a patternRef; resolve pattern nodes via patterns.ts first.",
      );
    }
    return createWpBlock(node);
  });
  return wpSerialize(instances);
}
