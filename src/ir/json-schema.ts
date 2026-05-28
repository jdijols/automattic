// The publishable JSON Schema (origin §8.1) — the provider-agnostic artifact
// Track 3 codes against (U7 freezes it to contract/ir-v1.schema.json). Emitted
// from the same Zod source as the runtime validator (irStructuralSchema), so the
// published contract and the enforced contract cannot silently diverge.
//
// Note: the depth/total-node bound (a Zod check, not a structural keyword) is
// NOT expressible in JSON Schema and so is absent here; it is enforced by U4's
// raw pre-walk against the MAX_DEPTH/MAX_TOTAL_NODES constants. Everything
// structural — additionalProperties:false, the block enum, the strict-armed
// node union, size bounds — is faithfully represented.
import * as z from "zod";

import { irStructuralSchema } from "./schema";

// io: "input" — the published schema describes what Track 3 must PRODUCE, so
// fields with a default (nodeKind, wpVersionTarget) are optional, not required.
export const irJsonSchema = z.toJSONSchema(irStructuralSchema, {
  target: "draft-2020-12",
  io: "input",
}) as Record<string, unknown>;
