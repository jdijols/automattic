// Layer 1 — schema validation + structural bounds (origin §5.1 step 1).
//
// Two responsibilities, in order:
//   (a) a raw-JSON pre-walk that enforces MAX_DEPTH / MAX_TOTAL_NODES BEFORE any
//       recursion-heavy parse. This is the real resource-exhaustion guard (the
//       U3 finding: irSchema.safeParse alone throws RangeError on a ~1k-deep
//       tree). The walk is ITERATIVE with an explicit stack and short-circuits
//       on the first breach, so it never recurses into a pathological tree.
//   (b) a Zod structural parse with a LENIENT block name (block: string, not the
//       allowlist enum). The published contract (U3) constrains GENERATION via
//       the enum; the validator defends against UNTRUSTED output, so a
//       hallucinated block must pass layer 1 structurally and be caught at layer
//       2a as BLOCK_NOT_ALLOWED with an actionable path/hint (origin §5.1 "layer
//       2 owns the hallucinated block name invariant"). additionalProperties is
//       still false everywhere, so an invented node-level key (rawHtml) is
//       rejected here.
import * as z from "zod";

import {
  MAX_DEPTH,
  MAX_INNER_BLOCKS,
  MAX_TEXT_LENGTH,
  MAX_TOTAL_NODES,
  designTokensSchema,
  paramSlotSchema,
} from "../ir/schema";
import { type ValidationError, type ValidationResult, makeError } from "./errors";

const nodeKind = z.enum(["static", "template-region"]).default("static");

const blockNodeLenient = z.strictObject({
  block: z.string().min(1), // lenient — allowlist membership is layer 2a's job
  nodeKind,
  attributes: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  get innerBlocks() {
    return z.array(nodeLenient).max(MAX_INNER_BLOCKS).optional();
  },
});

const patternRefLenient = z.strictObject({
  pattern: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  nodeKind,
  params: z.record(z.string(), paramSlotSchema).optional(),
});

const nodeLenient = z.union([blockNodeLenient, patternRefLenient]);

const regionLenient = z.strictObject({
  kind: z.enum(["template", "part"]),
  name: z.enum(["index", "single", "archive", "page", "home", "404", "header", "footer"]),
  content: z.array(nodeLenient),
});

const irValidatorSchema = z.strictObject({
  irVersion: z.literal(1),
  theme: z.strictObject({
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    title: z.string().min(1).max(120),
    author: z.string().max(120).optional(),
    description: z.string().max(280).optional(),
    wpVersionTarget: z.literal("6.6").default("6.6"),
  }),
  tokens: designTokensSchema,
  regions: z.array(regionLenient).min(1),
});

export type IRValidated = z.infer<typeof irValidatorSchema>;
export type ValidatedNode = z.infer<typeof nodeLenient>;
export type ValidatedBlockNode = z.infer<typeof blockNodeLenient>;
export type ValidatedPatternRef = z.infer<typeof patternRefLenient>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Iterative, short-circuiting pre-walk over the RAW input. Returns at most one
 * bound error. Never recurses (no stack-overflow exposure) and never visits more
 * than MAX_TOTAL_NODES+1 nodes (bounded memory) even on adversarial input.
 */
function checkStructuralBounds(input: Record<string, unknown>): ValidationError[] {
  const regions = input.regions;
  if (!Array.isArray(regions)) return []; // let Zod report the shape error

  let total = 0;
  const stack: { node: unknown; depth: number }[] = [];

  const enqueue = (node: unknown, depth: number): boolean => {
    total += 1;
    if (total > MAX_TOTAL_NODES) return false;
    stack.push({ node, depth });
    return true;
  };

  const countError = (): ValidationError[] => [
    makeError({
      code: "NODE_COUNT_EXCEEDED",
      layer: "schema",
      path: "regions",
      message: `IR exceeds the maximum total node count of ${MAX_TOTAL_NODES}.`,
    }),
  ];

  for (const region of regions) {
    if (!isPlainObject(region) || !Array.isArray(region.content)) continue;
    for (const node of region.content) {
      if (!enqueue(node, 1)) return countError();
    }
  }

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!isPlainObject(node)) continue;
    if (depth > MAX_DEPTH) {
      return [
        makeError({
          code: "DEPTH_BOUND_EXCEEDED",
          layer: "schema",
          path: "regions",
          message: `Block tree exceeds the maximum nesting depth of ${MAX_DEPTH}.`,
        }),
      ];
    }
    const inner = node.innerBlocks;
    if (Array.isArray(inner)) {
      for (const child of inner) {
        if (!enqueue(child, depth + 1)) return countError();
      }
    }
  }
  return [];
}

function mapZodIssues(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) =>
    makeError({
      code: "SCHEMA_VALIDATION",
      layer: "schema",
      path: issue.path.length > 0 ? issue.path.join(" › ") : "(root)",
      // issue.message is Zod's own human-readable text, not a raw schema dump.
      message: issue.message,
    }),
  );
}

/** Layer 1: bounds pre-walk, then lenient structural parse. Never throws. */
export function layer1(input: unknown): ValidationResult<IRValidated> {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        makeError({
          code: "MALFORMED_INPUT",
          layer: "schema",
          path: "(root)",
          message: "Input is not a JSON object.",
        }),
      ],
    };
  }

  const boundErrors = checkStructuralBounds(input);
  if (boundErrors.length > 0) return { ok: false, errors: boundErrors };

  const parsed = irValidatorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: mapZodIssues(parsed.error) };

  return { ok: true, value: parsed.data };
}
