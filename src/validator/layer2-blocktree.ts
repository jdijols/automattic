// Layer 2 — block-tree validation (origin §5.1 step 2). Two passes:
//   2a (per-node/per-pattern): allowlist membership, containment grammar,
//      attribute schema/ranges/URL safety, query config, and patternRef
//      resolution + param-kind matching. Owns the hallucinated-block invariant.
//   2b (post-composition): invariants no single node guarantees — exactly one
//      h1 per page, region uniqueness, and dangling-token-reference resolution
//      (the invalid-but-parseable class this backbone exists to catch).
import { type AllowedBlockName, isAllowedBlock } from "../blocks/allowlist";
import { type AttributeViolation, validateAttributes } from "../blocks/attributes";
import { type GrammarNode, allowedChildrenOf, validateContainment } from "../blocks/grammar";
import { querySchema } from "../ir/schema";
import { type ValidationError, makeError } from "./errors";
import {
  type IRValidated,
  type ValidatedBlockNode,
  type ValidatedNode,
  isPlainObject,
} from "./layer1-schema";
import { getDeclaredSlotKind, isKnownPattern } from "./pattern-catalog";

const SEP = " › ";

function regionPath(region: IRValidated["regions"][number]): string {
  return region.kind === "template" ? `templates/${region.name}.html` : `parts/${region.name}.html`;
}

function isBlockNode(node: ValidatedNode): node is ValidatedBlockNode {
  return "block" in node;
}

const ATTRIBUTE_VIOLATION_CODE = {
  UNKNOWN_ATTRIBUTE: "ATTRIBUTE_UNKNOWN",
  ATTRIBUTE_OUT_OF_RANGE: "ATTRIBUTE_OUT_OF_RANGE",
  UNSAFE_URL: "ATTRIBUTE_UNSAFE_URL",
} as const satisfies Record<AttributeViolation["kind"], ValidationError["code"]>;

// ---------------------------------------------------------------------------
// Layer 2a — per-node / per-pattern
// ---------------------------------------------------------------------------

/** Convert a blockNode subtree to a grammar node; patternRef children are opaque (dropped). */
function toGrammarNode(node: ValidatedBlockNode): GrammarNode {
  const innerBlocks = (node.innerBlocks ?? [])
    .filter(isBlockNode)
    .map(toGrammarNode);
  return { block: node.block, innerBlocks };
}

export function layer2a(ir: IRValidated): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const region of ir.regions) {
    const prefix = regionPath(region);
    walkNodes(region.content, [prefix], errors);

    // Containment runs per top-level blockNode so the region root has no parent.
    for (const node of region.content) {
      if (!isBlockNode(node)) continue;
      for (const v of validateContainment(toGrammarNode(node))) {
        errors.push(
          makeError({
            code: "BLOCK_CONTAINMENT",
            layer: "block-tree",
            path: `${prefix}${SEP}${v.path}`,
            message: v.message,
          }),
        );
      }
    }
  }

  return errors;
}

function walkNodes(nodes: ValidatedNode[], pathSegs: string[], errors: ValidationError[]): void {
  for (const node of nodes) {
    if (isBlockNode(node)) {
      const here = [...pathSegs, node.block];
      const path = here.join(SEP);

      if (!isAllowedBlock(node.block)) {
        // WordPress lowercases block names at parse time, so any casing of the
        // Custom HTML block is the SAME disqualifying block — tag it wp-html.
        const isCustomHtml = node.block.trim().toLowerCase() === "core/html";
        errors.push(
          makeError({
            code: "BLOCK_NOT_ALLOWED",
            layer: "block-tree",
            path,
            message: `Block '${node.block}' is not in the allowlist.`,
            invariant: isCustomHtml ? "wp-html" : "hallucinated-block-name",
            hint: isCustomHtml
              ? "The Custom HTML block is disallowed; use native blocks."
              : "Use a block from the allowlist.",
          }),
        );
      } else {
        validateBlockAttributes(node.block, node.attributes ?? {}, path, errors);
      }

      const children = node.innerBlocks ?? [];

      // A blockNode whose grammar restricts its children (columns, buttons,
      // list, social-links, query-pagination, void leaves) cannot legitimately
      // contain a patternRef as a direct child — the grammar walk drops
      // patternRefs, so this case is caught here explicitly (a patternRef
      // expands to its own root block, which the closed child set excludes).
      const closedChildren = allowedChildrenOf(node.block);
      if (closedChildren !== undefined) {
        for (const child of children) {
          if (!isBlockNode(child)) {
            errors.push(
              makeError({
                code: "BLOCK_CONTAINMENT",
                layer: "block-tree",
                path: `${here.join(SEP)}${SEP}pattern:${child.pattern}`,
                message:
                  closedChildren.length === 0
                    ? `${node.block} may not contain child blocks; found a pattern reference.`
                    : `${node.block} may only contain ${closedChildren.join(", ")}, not a pattern reference.`,
              }),
            );
          }
        }
      }

      if (children.length > 0) walkNodes(children, here, errors);
    } else {
      const here = [...pathSegs, `pattern:${node.pattern}`];
      const path = here.join(SEP);
      if (!isKnownPattern(node.pattern)) {
        errors.push(
          makeError({
            code: "PATTERN_NOT_FOUND",
            layer: "block-tree",
            path,
            message: `Pattern '${node.pattern}' is not in the catalog.`,
          }),
        );
      } else {
        validatePatternParams(node.pattern, node.params ?? {}, path, errors);
      }
    }
  }
}

function validateBlockAttributes(
  block: AllowedBlockName,
  attributes: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): void {
  for (const v of validateAttributes(block, attributes)) {
    errors.push(
      makeError({
        code: ATTRIBUTE_VIOLATION_CODE[v.kind],
        layer: "block-tree",
        path,
        message: v.message,
      }),
    );
  }

  // core/query carries a typed query sub-object (origin §2.4; IR-notes #7).
  if (block === "core/query" && isPlainObject(attributes.query)) {
    const parsed = querySchema.safeParse(attributes.query);
    if (!parsed.success) {
      errors.push(
        makeError({
          code: "QUERY_CONFIG_INVALID",
          layer: "block-tree",
          path,
          message: `Invalid core/query configuration: ${parsed.error.issues[0]?.message ?? "out of bounds"}.`,
        }),
      );
    }
  }
}

function validatePatternParams(
  pattern: string,
  params: Record<string, { kind: string; value: unknown }>,
  path: string,
  errors: ValidationError[],
): void {
  for (const [slot, param] of Object.entries(params)) {
    const declared = getDeclaredSlotKind(pattern, slot);
    if (declared !== undefined && declared !== param.kind) {
      errors.push(
        makeError({
          code: "PATTERN_PARAM_KIND_MISMATCH",
          layer: "block-tree",
          path: `${path}${SEP}${slot}`,
          message: `Pattern '${pattern}' slot '${slot}' expects a ${declared} param, got ${param.kind}.`,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 2b — post-composition
// ---------------------------------------------------------------------------

const VAR_PRESET = /var:preset\|(color|font-size|spacing|gradient)\|([a-z0-9][a-z0-9-]*)/g;
const BARE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const NAMED_COLOR_ATTRS = ["backgroundColor", "textColor", "overlayColor"] as const;

// WordPress core ships default presets that resolve at render time WITHOUT being
// declared in the theme's theme.json (unless the theme opts out via
// defaultPalette/defaultFontSizes:false). Accepting them prevents false-positive
// dangling-reference rejections of valid themes that use a core default. Being
// generous here errs toward not blocking valid output; a genuinely invented slug
// (e.g. "brand") still fails. (gradient defaults are not modeled — see below.)
const CORE_DEFAULT_COLOR_SLUGS = new Set([
  "black",
  "cyan-bluish-gray",
  "white",
  "pale-pink",
  "vivid-red",
  "luminous-vivid-orange",
  "luminous-vivid-amber",
  "light-green-cyan",
  "vivid-green-cyan",
  "pale-cyan-blue",
  "vivid-cyan-blue",
  "vivid-purple",
]);
const CORE_DEFAULT_FONT_SIZE_SLUGS = new Set(["small", "medium", "large", "x-large", "xx-large"]);
const CORE_DEFAULT_SPACING_SLUGS = new Set(["20", "30", "40", "50", "60", "70", "80"]);

export function layer2b(ir: IRValidated): ValidationError[] {
  const errors: ValidationError[] = [];

  // Region uniqueness — one header, one footer, one of each template.
  const seen = new Set<string>();
  for (const region of ir.regions) {
    const key = `${region.kind}:${region.name}`;
    if (seen.has(key)) {
      errors.push(
        makeError({
          code: "REGION_NOT_UNIQUE",
          layer: "block-tree",
          path: regionPath(region),
          message: `Duplicate region '${region.name}' — each region must be unique.`,
        }),
      );
    }
    seen.add(key);
  }

  // Token reference resolution + h1 count (single tree walk).
  const colorSlugs = new Set((ir.tokens.colors ?? []).map((c) => c.slug));
  const fontSizeSlugs = new Set((ir.tokens.fontSizes ?? []).map((c) => c.slug));
  const spacingSlugs = new Set((ir.tokens.spacing ?? []).map((c) => c.slug));

  // A reference resolves if it is declared in the IR tokens OR is a WordPress
  // core default preset.
  const resolvesColor = (s: string): boolean => colorSlugs.has(s) || CORE_DEFAULT_COLOR_SLUGS.has(s);
  const resolvesFontSize = (s: string): boolean =>
    fontSizeSlugs.has(s) || CORE_DEFAULT_FONT_SIZE_SLUGS.has(s);
  const resolvesSpacing = (s: string): boolean =>
    spacingSlugs.has(s) || CORE_DEFAULT_SPACING_SLUGS.has(s);
  const resolvesAny = (s: string): boolean =>
    resolvesColor(s) || resolvesFontSize(s) || resolvesSpacing(s);

  let h1Count = 0;
  const dangling = (path: string, ref: string): void => {
    errors.push(
      makeError({
        code: "DANGLING_TOKEN_REFERENCE",
        layer: "block-tree",
        path,
        message: `Token reference '${ref}' does not resolve against the declared tokens.`,
      }),
    );
  };

  const resolverFor = (category: string): ((s: string) => boolean) | null => {
    if (category === "color") return resolvesColor;
    if (category === "font-size") return resolvesFontSize;
    if (category === "spacing") return resolvesSpacing;
    return null; // gradient (not modeled) — skip; a known false-negative edge.
  };

  const scanForVarPresets = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      let m: RegExpExecArray | null;
      VAR_PRESET.lastIndex = 0;
      while ((m = VAR_PRESET.exec(value)) !== null) {
        const resolves = resolverFor(m[1]!);
        if (resolves && !resolves(m[2]!)) dangling(path, `var:preset|${m[1]}|${m[2]}`);
      }
    } else if (Array.isArray(value)) {
      for (const v of value) scanForVarPresets(v, path);
    } else if (isPlainObject(value)) {
      for (const v of Object.values(value)) scanForVarPresets(v, path);
    }
  };

  const visit = (node: ValidatedNode, pathSegs: string[]): void => {
    if (isBlockNode(node)) {
      const here = [...pathSegs, node.block];
      const path = here.join(SEP);
      const attrs = node.attributes ?? {};

      if (node.block === "core/heading" && attrs.level === 1) h1Count += 1;

      // var:preset references anywhere in the attribute tree.
      scanForVarPresets(attrs, path);

      // Bare-slug preset references (backgroundColor:"base", fontSize:"large").
      for (const attr of NAMED_COLOR_ATTRS) {
        const v = attrs[attr];
        if (typeof v === "string" && BARE_SLUG.test(v) && !resolvesColor(v)) dangling(path, `${attr}:${v}`);
      }
      const fs = attrs.fontSize;
      if (typeof fs === "string" && BARE_SLUG.test(fs) && !resolvesFontSize(fs)) {
        dangling(path, `fontSize:${fs}`);
      }

      for (const child of node.innerBlocks ?? []) visit(child, here);
    } else {
      const here = [...pathSegs, `pattern:${node.pattern}`];
      // tokenRef params must resolve against the declared vocabulary.
      for (const [slot, param] of Object.entries(node.params ?? {})) {
        if (param.kind === "tokenRef" && typeof param.value === "string") {
          const v = param.value;
          if (BARE_SLUG.test(v) ? !resolvesAny(v) : false) dangling(`${here.join(SEP)}${SEP}${slot}`, v);
          else scanForVarPresets(v, `${here.join(SEP)}${SEP}${slot}`);
        }
      }
    }
  };

  for (const region of ir.regions) {
    for (const node of region.content) visit(node, [regionPath(region)]);
  }

  if (h1Count > 1) {
    errors.push(
      makeError({
        code: "MULTIPLE_H1",
        layer: "block-tree",
        path: "(document)",
        message: `A page must have exactly one h1; found ${h1Count}.`,
        hint: "Keep the hero's heading at level 1 and use level 2+ elsewhere.",
      }),
    );
  }

  return errors;
}
