// T3-U6 — the single public entry point Track 4 / integration call (origin §7,
// R7). It composes the pipeline — limits-wrapper → arm (C-single by default) →
// result — emitting coarse progress + telemetry through the injected seams, and
// returns ONLY the narrow downstream contract (validated IR or the legible §5.2
// error list). It exposes nothing of the prompt, provider, validator internals,
// or model-tier decisions.
//
// Three injection seams are DEFINED here (Phase A) and POPULATED later, with no
// cycle and no stranded branch:
//   • telemetry-sink (T3-U5) — passed through to the arm; default no-op.
//   • limits-wrapper (T3-U10) — input cap / throttle / spend guard; default a
//     pass-through identity. T3-U10 swaps in the real guard.
//   • arm-selection (T3-U9) — a SINGLE config point that selects the generation
//     strategy. Default = C-single (T3-U4's retry loop). T3-U9's experiment
//     decision flips this to C-decomposed (T3-U7) as a one-line swap, so the
//     escalate branch is buildable today, not stranded.
import { type GenerationResult, type ProgressListener } from "./contract";
import { type GenerateInput } from "./generate";
import { type LanguageModel } from "ai";
import { type RetryOutcome, generateWithRetry } from "./retry-loop";
import { NOOP_SINK, type TelemetrySink } from "./telemetry";

/**
 * A generation arm: maps an input to a retry outcome. C-single (T3-U4) and
 * C-decomposed (T3-U7) both satisfy this shape, so the arm-selection seam can
 * swap one for the other without touching the entry point.
 */
export type GenerationArm = (
  input: GenerateInput,
  deps: { model?: LanguageModel; sink: TelemetrySink; onProgress: ProgressListener },
) => Promise<RetryOutcome>;

/** The default arm: the C-single retry loop (T3-U4). */
const C_SINGLE_ARM: GenerationArm = (input, deps) => generateWithRetry(input, deps);

/** A limits wrapper: transforms the input before generation. Default = identity. */
export type LimitsWrapper = (input: GenerateInput) => GenerateInput;
const PASS_THROUGH_LIMITS: LimitsWrapper = (input) => input;

export interface GenerateThemeDeps {
  /** Override the model (tests inject a mock). */
  model?: LanguageModel;
  /** Telemetry sink seam (T3-U5). Default no-op. */
  sink?: TelemetrySink;
  /** Progress listener seam (T3-U6). Default no-op. */
  onProgress?: ProgressListener;
  /** Input limits seam (T3-U10). Default pass-through. */
  limits?: LimitsWrapper;
  /** Arm-selection config point (T3-U9 flips this). Default C-single. */
  arm?: GenerationArm;
}

/**
 * Generate a theme IR from a natural-language description + structured criteria.
 * Returns exactly a validated IR or the legible §5.2 error list (the error list
 * is passed through byte-unmodified). Transient/operational provider errors
 * (timeout, rate-limit, network) PROPAGATE as throws for the server boundary
 * (T3-U10) to convert into a user-facing failure — the loop cannot fix them by
 * re-prompting; callers at that boundary wrap this in try/catch.
 */
export async function generateTheme(input: GenerateInput, deps: GenerateThemeDeps = {}): Promise<GenerationResult> {
  const limits = deps.limits ?? PASS_THROUGH_LIMITS;
  const arm = deps.arm ?? C_SINGLE_ARM;
  const sink = deps.sink ?? NOOP_SINK;
  const onProgress = deps.onProgress ?? (() => undefined);

  const bounded = limits(input);
  const outcome = await arm(bounded, { model: deps.model, sink, onProgress });

  return outcome.result.ok
    ? { status: "done", ir: outcome.result.value }
    : { status: "failed", errors: outcome.result.errors };
}

export { type GenerationResult, type ProgressListener, type ProgressSignal } from "./contract";
