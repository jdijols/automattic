// T3-U6 — the narrow downstream contract Track 4 and integration consume
// (origin §7, R7). It exposes EXACTLY two things: the result (a validated IR or
// the legible §5.2 error list, passed through byte-unmodified) and a coarse
// progress stream so the UI can show motion during the latency window. It
// exposes NOTHING of the prompt, the provider, validator internals, or model-
// tier decisions (R7's negative contract).
import { type IRValidated, type ValidationError } from "../validator";

/**
 * The public result. `failed.errors` is the §5.2 list passed through verbatim —
 * the closed `code` enum is what makes Track 4's rendering deterministic. There
 * is no field for the prompt, provider name, or tier decision.
 */
export type GenerationResult =
  | { status: "done"; ir: IRValidated }
  | { status: "failed"; errors: ValidationError[] };

/**
 * Coarse progress phases: generating → validating → retrying (n/3) → done|failed.
 * `validating` is reserved for arms that expose a distinct validation phase
 * (C-decomposed per-region); the C-single arm emits generating/retrying + a
 * terminal done|failed.
 */
export type ProgressPhase = "generating" | "validating" | "retrying" | "done" | "failed";

export interface ProgressSignal {
  phase: ProgressPhase;
  /** 1-based attempt number (generating/retrying). */
  attempt?: number;
  /** The retry budget (the "/3" in "retrying (n/3)"). */
  of?: number;
}

/** A progress listener — the channel Track 4 subscribes to for motion. */
export type ProgressListener = (signal: ProgressSignal) => void;
