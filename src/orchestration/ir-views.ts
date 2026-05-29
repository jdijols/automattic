// T3-U1 — the IR schema view split: TWO views of ONE source (origin §3.5).
//
//   • the GENERATION view (this module) — what Track 3 PRODUCES. The envelope is
//     preserved verbatim from the frozen contract source (`irStructuralSchema`),
//     but the recursive `content` is collapsed to a permissive
//     `z.array(z.unknown())`. Because no recursive Zod node is ever sent to the
//     provider in C-single, neither the v3 inlining trap (#4701) nor the v4
//     recursive-root `allOf`/`$ref`-without-`type` trap (#10240) can fire on the
//     MVP generation path (deepening: feasibility P2-1).
//   • the VALIDATION view — what the Track-1 validator GUARANTEES. Re-exported
//     below as `IRValidated`. Track 3 REIMPLEMENTS NO VALIDATION: a candidate
//     this view shapes is still gated by `validateIR` before it is ever returned
//     or assembled (wired in T3-U3).
//
// Both views derive from the single source of truth `irStructuralSchema`, so the
// produce-shape and the enforce-shape cannot silently diverge at the envelope.
import * as z from "zod";

import { irStructuralSchema } from "../ir/schema";
import type { IRValidated } from "../validator";

// The region element, taken from the one source schema. Its recursive `content`
// is replaced with a permissive array; everything else (kind/name enums) is
// inherited unchanged so the envelope tracks the contract automatically.
const sourceRegion = irStructuralSchema.shape.regions.element;

const generationRegionSchema = sourceRegion
  .omit({ content: true })
  .extend({ content: z.array(z.unknown()) });

/**
 * The generation view: envelope-tight, content-permissive. This is the schema
 * `generateObject` consumes (T3-U1/T3-U3).
 */
export const irGenerationSchema = irStructuralSchema
  .omit({ regions: true })
  .extend({ regions: z.array(generationRegionSchema).min(1) });

export type IRGenerated = z.infer<typeof irGenerationSchema>;

/**
 * The publishable, provider-acceptable JSON Schema for the generation view.
 * `io: "input"` describes what Track 3 must PRODUCE, so default-bearing fields
 * (nodeKind, wpVersionTarget) are optional rather than required.
 */
export const irGenerationJsonSchema = z.toJSONSchema(irGenerationSchema, {
  target: "draft-2020-12",
  io: "input",
}) as Record<string, unknown>;

// The validated view — what the Track-1 validator returns. Surfaced here so the
// produce/guarantee pair lives in one place and Track 3 imports the validator
// interface rather than reimplementing it.
export type { IRValidated };
