// T3-U3 — the C-single generation function (origin §3.5, R1/R3/R6).
//
//   (NL description, structured criteria) → validated IR | structured error list
//
// One pass: build the prompt (T3-U2) → one `generateObject` call (T3-U1) → one
// `experimental_repairText` attempt if the JSON is malformed → the AUTHORITATIVE
// Track-1 validation gate (`validateIR`).
//
// Generation-outcome contract (R6): NO unvalidated object ever escapes and NO
// failure is silent. A model that produces something yields either a validated
// IR or a §5.2 legible error list; a model that produces nothing parseable
// yields MALFORMED_INPUT. Conditions OUTSIDE the generation outcome are not
// silently swallowed — they propagate (loudly) to their owning layer: invalid
// caller-supplied criteria throw (validated at the T3-U10 input boundary), and
// transient/operational provider errors (timeout, rate-limit, network) propagate
// as throws for the T3-U4 loop to classify (see provider.ts).
//
// Repair is NOT a gate-skip: a repaired candidate is still an UNVALIDATED
// candidate and must clear `validateIR` like any other (origin §5.1 repair-
// revalidation invariant). A prompt-injected hostile value (e.g. a `javascript:`
// URL) that survives a "successful" repair is still rejected by the validator.
//
// NOTE on the real validator: Track-1 layers 1–3 have landed, so this composes
// the REAL `validateIR` directly — no fake-validator stub (that scaffold existed
// only for the window before the validator shipped).
//
// NOTE on producer guards: the T3-U2 producer guards are integrated by the
// T3-U4 retry loop (their value is sparing retry budget / driving the re-prompt),
// per the deepened architecture note (guards run inside the loop, on the
// candidate). This single-shot function's authoritative gate is `validateIR`.
import type { LanguageModel } from "ai";

import { type IRValidated, type ValidationResult, validateIR } from "../validator";
import { makeError } from "../validator/errors";

import { irGenerationSchema } from "./ir-views";
import { type GenerateFailure, generateStructured } from "./provider";
import { type BuildPromptInput, buildPrompt } from "./prompt";

export type GenerateInput = BuildPromptInput;

export interface GenerateDeps {
  /** Override the model (tests inject a mock). Defaults to the provider seam's Sonnet. */
  model?: LanguageModel;
}

/**
 * One-attempt JSON repair for `experimental_repairText`: strip a Markdown code
 * fence and trim to the outermost object. Returns null when there is no object
 * to recover (the SDK then surfaces NoObjectGeneratedError, which we map to a
 * legible MALFORMED_INPUT error).
 */
export function repairJsonText(text: string): string | null {
  const defenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = defenced.indexOf("{");
  const end = defenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return defenced.slice(start, end + 1);
}

/** Map a provider no-object failure to a §5.2 legible error (never a throw). */
function malformedError(failure: GenerateFailure): ValidationResult<never> {
  const truncated = failure.finishReason === "length";
  return {
    ok: false,
    errors: [
      makeError({
        code: "MALFORMED_INPUT",
        layer: "schema",
        path: "",
        message: truncated
          ? "The model response was truncated before a complete IR object could be parsed."
          : "The model did not return a parseable IR JSON object, and one repair attempt did not recover it.",
        hint: truncated ? "Output was cut off; the generation needs a higher token budget." : undefined,
      }),
    ],
  };
}

/**
 * Generate one IR candidate and run it through the authoritative validator.
 * Provider-agnostic: the result shape is identical regardless of the model.
 */
export async function generateSingle(
  input: GenerateInput,
  deps: GenerateDeps = {},
): Promise<ValidationResult<IRValidated>> {
  const { system, prompt } = buildPrompt(input);

  const outcome = await generateStructured(irGenerationSchema, {
    system,
    prompt,
    model: deps.model,
    repairText: async ({ text }) => repairJsonText(text),
  });

  if (!outcome.ok) {
    return malformedError(outcome);
  }

  // The candidate is UNVALIDATED (repaired or not). The validator is the gate.
  return validateIR(outcome.object);
}
