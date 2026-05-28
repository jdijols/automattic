// The validator orchestrator (origin §5.1) — a fixed-order, fail-closed pipeline.
// Each layer is `input → ValidationResult`; a failing layer short-circuits with
// its error list, so the result is either a typed artifact or a structured error
// list, NEVER a silent pass and NEVER an exception on untrusted input.
//
// This is the COMPLETE four-layer orchestrator interface. Layer 3 (theme.json,
// U5) and layer 4 (assembled-artifact, U9) plug into the marked seams below;
// their error codes are already in the frozen enum (errors.ts), so the contract
// is whole at the U7 freeze and Phase B adds no new codes.
import { type ValidationError, type ValidationResult } from "./errors";
import { type IRValidated, layer1 } from "./layer1-schema";
import { layer2a, layer2b } from "./layer2-blocktree";
import { layer3 } from "./layer3-themejson";

export type { ValidationError, ValidationResult, ErrorCode, ValidationLayer, Invariant } from "./errors";
export { ERROR_CODES } from "./errors";
export type { IRValidated } from "./layer1-schema";

/**
 * Validate untrusted IR through layers 1–2 (Phase A). Returns the validated IR
 * artifact, or the structured error list from the first failing layer.
 */
export function validateIR(input: unknown): ValidationResult<IRValidated> {
  // Layer 1 — schema + structural bounds.
  const l1 = layer1(input);
  if (!l1.ok) return l1;
  const ir = l1.value;

  // Layer 2a — per-node structural validation.
  const errors2a = layer2a(ir);
  if (errors2a.length > 0) return fail(errors2a);

  // Layer 2b — post-composition document validation.
  const errors2b = layer2b(ir);
  if (errors2b.length > 0) return fail(errors2b);

  // Layer 3 — compile tokens → theme.json, validate with AJV + token values.
  const errors3 = layer3(ir);
  if (errors3.length > 0) return fail(errors3);

  // ── Layer 4 seam (U9): byte-scan assembled output for wp:html + re-parse names.
  //    (runs post-assembly, against the artifact — wired in the assembler path.)

  return { ok: true, value: ir };
}

function fail(errors: ValidationError[]): ValidationResult<never> {
  return { ok: false, errors };
}
