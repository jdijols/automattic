// Containment grammar (origin §4.2). A flat allowlist still permits structurally
// nonsensical trees — a `core/column` at template root, a `core/post-title`
// outside any query loop — that install without warning but render broken
// (`core/missing`, block invalidation). WordPress encodes these as the block
// API's `parent` / `ancestor` / `allowedBlocks` constraints but enforces them
// only in the editor inserter, not at parse time, so we re-encode them as a
// pre-package gate.
//
// Pure data + pure functions, no IR dependency: U4's layer-2a walks the IR with
// validateContainment and maps the violations onto the structured error format.
import { type AllowedBlockName } from "./allowlist";

interface ContainmentRule {
  /** The node's direct parent must be one of these blocks. */
  requiredParent?: AllowedBlockName[];
  /** Some ancestor (any depth) must be one of these blocks. */
  requiredAncestor?: AllowedBlockName[];
  /** If present, the node's direct children must all be in this set. */
  allowedChildren?: AllowedBlockName[];
}

// Only the constrained blocks appear here; unlisted blocks default to "any flow
// content as child, any container as parent". Each rule mirrors the exact
// `parent` / `ancestor` / `allowedBlocks` declared in the block's `block.json`
// in the pinned `@wordpress/block-library` (verified at the pinned version),
// which is the authority the §4.2 grammar re-encodes — WordPress enforces these
// only in the editor inserter, not at parse time.
//
// Two deliberate deviations from raw block.json, both per origin §4.2 / IR-notes
// (stricter, never looser — they only reject more):
//   - post-* leaves carry requiredAncestor:["core/post-template"] though their
//     block.json declares no constraint. In this generator post fields only ever
//     appear inside a query loop, so a post-title outside a post-template is a
//     generation defect we reject up front.
const GRAMMAR: Partial<Record<AllowedBlockName, ContainmentRule>> = {
  // Layout containers (block.json `allowedBlocks` / `parent`).
  "core/columns": { allowedChildren: ["core/column"] },
  "core/column": { requiredParent: ["core/columns"] },
  "core/buttons": { allowedChildren: ["core/button"] },
  "core/button": { requiredParent: ["core/buttons"], allowedChildren: [] },
  "core/list": { allowedChildren: ["core/list-item"] },
  "core/list-item": { requiredParent: ["core/list"], allowedChildren: ["core/list"] },
  "core/social-links": { allowedChildren: ["core/social-link"] },
  "core/social-link": { requiredParent: ["core/social-links"], allowedChildren: [] },
  // Query-loop family. post-template / query-pagination / query-no-results use
  // ANCESTOR (not parent) in WP — they may be nested through intermediate
  // containers (e.g. query › group › post-template), which is a common layout.
  "core/post-template": { requiredAncestor: ["core/query"] },
  "core/query-pagination": {
    requiredAncestor: ["core/query"],
    allowedChildren: [
      "core/query-pagination-previous",
      "core/query-pagination-numbers",
      "core/query-pagination-next",
    ],
  },
  "core/query-no-results": { requiredAncestor: ["core/query"] },
  "core/query-pagination-previous": {
    requiredParent: ["core/query-pagination"],
    allowedChildren: [],
  },
  "core/query-pagination-numbers": {
    requiredParent: ["core/query-pagination"],
    allowedChildren: [],
  },
  "core/query-pagination-next": {
    requiredParent: ["core/query-pagination"],
    allowedChildren: [],
  },
  "core/post-title": { requiredAncestor: ["core/post-template"], allowedChildren: [] },
  "core/post-excerpt": { requiredAncestor: ["core/post-template"], allowedChildren: [] },
  "core/post-date": { requiredAncestor: ["core/post-template"], allowedChildren: [] },
  "core/post-featured-image": {
    requiredAncestor: ["core/post-template"],
    allowedChildren: [],
  },
};

/** Minimal tree shape the grammar walks — deliberately not the full IR node. */
export interface GrammarNode {
  block: string;
  innerBlocks?: GrammarNode[];
}

export type ContainmentViolationKind = "PARENT" | "ANCESTOR" | "CHILD";

export interface ContainmentViolation {
  kind: ContainmentViolationKind;
  /** The offending block. */
  block: string;
  /** Path from the region root to the offending node, e.g. "core/query › core/post-template › core/group". */
  path: string;
  message: string;
}

const PATH_SEP = " › ";

/**
 * Walk a block tree and return every containment violation, each with a precise
 * root-to-node path. An empty array means the tree is structurally legal.
 * Only blocks on the allowlist carry rules; membership itself is U2/allowlist's
 * job and U4 checks it as a separate layer-2a pass.
 */
export function validateContainment(root: GrammarNode): ContainmentViolation[] {
  const violations: ContainmentViolation[] = [];

  const walk = (node: GrammarNode, ancestors: string[]): void => {
    const path = [...ancestors, node.block];
    const parent = ancestors[ancestors.length - 1];
    const rule = GRAMMAR[node.block as AllowedBlockName];

    if (rule?.requiredParent) {
      if (parent === undefined || !rule.requiredParent.includes(parent as AllowedBlockName)) {
        violations.push({
          kind: "PARENT",
          block: node.block,
          path: path.join(PATH_SEP),
          message: `${node.block} must be a direct child of ${formatList(rule.requiredParent)}${
            parent === undefined ? " (found at region root)" : `, not ${parent}`
          }.`,
        });
      }
    }

    if (rule?.requiredAncestor) {
      const hasAncestor = rule.requiredAncestor.some((a) => ancestors.includes(a));
      if (!hasAncestor) {
        violations.push({
          kind: "ANCESTOR",
          block: node.block,
          path: path.join(PATH_SEP),
          message: `${node.block} must appear inside a ${formatList(rule.requiredAncestor)} subtree.`,
        });
      }
    }

    const childRule = rule?.allowedChildren;
    const children = node.innerBlocks ?? [];
    if (childRule) {
      for (const child of children) {
        if (!childRule.includes(child.block as AllowedBlockName)) {
          violations.push({
            kind: "CHILD",
            block: child.block,
            path: [...path, child.block].join(PATH_SEP),
            message:
              childRule.length === 0
                ? `${node.block} may not contain child blocks; found ${child.block}.`
                : `${node.block} may only contain ${formatList(childRule)}, not ${child.block}.`,
          });
        }
      }
    }

    for (const child of children) {
      walk(child, path);
    }
  };

  walk(root, []);
  return violations;
}

/**
 * The closed set of allowed child blocks for `block`, or undefined if the block
 * places no restriction on its children. A block with a defined (possibly empty)
 * allowedChildren cannot legitimately contain a patternRef expansion as a direct
 * child — layer 2a uses this to catch that case, which the blockNode-only
 * grammar walk cannot see.
 */
export function allowedChildrenOf(block: string): readonly AllowedBlockName[] | undefined {
  return GRAMMAR[block as AllowedBlockName]?.allowedChildren;
}

/** The parent a block must sit directly inside, or undefined if unconstrained. */
export function requiredParentOf(block: string): readonly AllowedBlockName[] | undefined {
  return GRAMMAR[block as AllowedBlockName]?.requiredParent;
}

/** An ancestor a block must appear under, or undefined if unconstrained. */
export function requiredAncestorOf(block: string): readonly AllowedBlockName[] | undefined {
  return GRAMMAR[block as AllowedBlockName]?.requiredAncestor;
}

function formatList(blocks: readonly string[]): string {
  if (blocks.length === 1) return blocks[0] as string;
  return `${blocks.slice(0, -1).join(", ")} or ${blocks[blocks.length - 1]}`;
}
