// T3-U7 — the C-decomposed escalation arm (origin §3.5, Q11). The per-region
// generation shape: ONE strict envelope call (theme metadata, tokens, the list
// of region shells) → PARALLEL per-region content calls under bounded
// concurrency → assemble → the authoritative `validateIR` gate.
//
// This is NOT the MVP default — it is the measured escalation arm the §3.6
// experiment (T3-U8) compares against C-single, selected only when T3-U9 flips
// the arm-selection config point. Its value: per-region trees are shallower than
// the monolithic tree, and constrained-decoding stays within a region.
//
// Partial-failure contract (Q11, resolved here): FAIL-FAST. If any region
// exhausts its budget, the whole IR fails with the legible error and in-flight
// region calls are aborted — no partial IR ever escapes or assembles.
//
// All calls (envelope + every region) share the SAME byte-stable system prefix
// (T3-U2 `buildContextPrefix`, via `buildPrompt`), so the within-session cache
// stays warm across the fan-out.
import { type LanguageModel } from "ai";
import * as z from "zod";

import { irStructuralSchema } from "../ir/schema";
import { type IRValidated, type ValidationError, type ValidationResult, validateIR } from "../validator";
import { makeError } from "../validator/errors";

import { type ProgressListener } from "./contract";
import { type GenerateInput, repairJsonText } from "./generate";
import { type GenerateFailure, generateStructured } from "./provider";
import { buildPrompt } from "./prompt";
import { NOOP_SINK, type TelemetrySink } from "./telemetry";

/** Max region calls in flight at once (bounded fan-out). */
export const REGION_CONCURRENCY = 4;

/** One repair attempt on malformed JSON — the same recovery C-single uses. */
const repairText = async ({ text }: { text: string }): Promise<string | null> => repairJsonText(text);

// The envelope view: the IR with region SHELLS (kind + name) but no content.
const envelopeRegion = irStructuralSchema.shape.regions.element.omit({ content: true });
const envelopeSchema = irStructuralSchema
  .omit({ regions: true })
  .extend({ regions: z.array(envelopeRegion).min(1) });
type Envelope = z.infer<typeof envelopeSchema>;

// One region's content: a permissive array of nodes (validated whole-IR later).
const regionContentSchema = z.strictObject({ content: z.array(z.unknown()) });

const ENVELOPE_TASK =
  "TASK: Emit ONLY the theme envelope — irVersion, theme metadata, tokens, and the list of regions as { kind, name } shells WITHOUT their content. Do not include any block content.";

function regionTask(region: { kind: string; name: string }): string {
  return `TASK: Emit ONLY a JSON object { "content": [ … ] } whose content array is the block-node / pattern-reference tree for the "${region.name}" ${region.kind} region. Emit nothing else.`;
}

export interface DecomposedDeps {
  model?: LanguageModel;
  sink?: TelemetrySink;
  onProgress?: ProgressListener;
}

function failure(errors: ValidationError[]): { ok: false; errors: ValidationError[] } {
  return { ok: false, errors };
}

function malformed(where: string, failureInfo: GenerateFailure): ValidationError {
  const truncated = failureInfo.finishReason === "length";
  return makeError({
    code: "MALFORMED_INPUT",
    layer: "schema",
    path: where,
    message: truncated
      ? `The ${where} generation was truncated before a complete object could be parsed.`
      : `The ${where} generation did not return a parseable object after one repair attempt.`,
  });
}

/**
 * Generate one region's content (one call + one repair attempt, like C-single).
 * Honors the abort signal: a collateral abort from a sibling's fail-fast returns
 * a quiet empty failure rather than throwing.
 */
async function generateRegion(
  region: { kind: string; name: string },
  input: GenerateInput,
  deps: DecomposedDeps,
  signal: AbortSignal,
): Promise<{ ok: true; content: unknown[] } | { ok: false; errors: ValidationError[] }> {
  if (signal.aborted) return failure([]);
  const { system, prompt } = buildPrompt({ ...input, correction: regionTask(region) });
  let outcome;
  try {
    outcome = await generateStructured(regionContentSchema, { system, prompt, model: deps.model, abortSignal: signal, repairText });
  } catch (error) {
    if (signal.aborted) return failure([]); // collateral abort from a sibling's fail-fast
    throw error; // a genuine transient error — propagates to the server boundary
  }
  if (outcome.ok) return { ok: true, content: outcome.object.content };
  return failure([malformed(`regions/${region.name}`, outcome)]);
}

/** Run `fn` over items with at most `limit` in flight; preserves index order in the result. */
async function boundedMap<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The C-decomposed arm. Conforms to the T3-U6 arm-selection seam shape, returning
 * a RetryOutcome-compatible `{ result, attempts }`.
 */
export async function generateDecomposed(
  input: GenerateInput,
  deps: DecomposedDeps = {},
): Promise<{ result: ValidationResult<IRValidated>; attempts: number }> {
  const onProgress = deps.onProgress ?? (() => undefined);
  const sink = deps.sink ?? NOOP_SINK;
  let attempts = 0;

  // 1) Envelope (strict).
  onProgress({ phase: "generating" });
  const envPrompt = buildPrompt({ ...input, correction: ENVELOPE_TASK });
  attempts += 1;
  const envOutcome = await generateStructured(envelopeSchema, {
    system: envPrompt.system,
    prompt: envPrompt.prompt,
    model: deps.model,
    repairText,
  });
  if (!envOutcome.ok) {
    sink.emit({ kind: "generation-failed", finishReason: envOutcome.finishReason, cause: undefined });
    onProgress({ phase: "failed" });
    return { result: failure([malformed("envelope", envOutcome)]), attempts };
  }
  const envelope: Envelope = envOutcome.object;

  // 2) Per-region content, parallel + bounded, FAIL-FAST on the first region failure.
  const controller = new AbortController();
  let firstFailure: ValidationError[] | null = null;
  const contents = await boundedMap(envelope.regions, REGION_CONCURRENCY, async (region) => {
    attempts += 1;
    const result = await generateRegion(region, input, deps, controller.signal);
    if (!result.ok && firstFailure === null && result.errors.length > 0) {
      firstFailure = result.errors;
      controller.abort(); // fail-fast: abort the in-flight siblings
    }
    return result;
  });

  if (firstFailure !== null) {
    onProgress({ phase: "failed" });
    return { result: failure(firstFailure), attempts };
  }

  // 3) Assemble: graft each region's content onto its envelope shell.
  const regions = envelope.regions.map((region, index) => {
    const content = contents[index];
    return { ...region, content: content && content.ok ? content.content : [] };
  });
  const assembled = { ...envelope, regions };

  // 4) Authoritative gate.
  onProgress({ phase: "validating" });
  const result = validateIR(assembled);
  onProgress({ phase: result.ok ? "done" : "failed" });
  return { result, attempts };
}
