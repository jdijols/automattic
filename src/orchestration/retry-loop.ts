// T3-U4 — the bounded trust-the-parser loop (origin §3.5, R3).
//
// Wrap the C-single generator (T3-U3) in a budget of 3 attempts (1 initial + 2
// retries). After each validation failure, the FULL §5.2 error list is turned
// into a correction suffix (reprompt.ts) and fed to the next attempt — carrying
// every outstanding issue each time is the anti-oscillation mitigation. The
// final attempt adds the pattern-only fallback. The hard cap bounds worst-case
// latency/cost: the loop fails loudly with the legible error rather than looping
// forever.
//
// The byte-stable system prefix is unchanged across attempts (only the suffix
// correction varies), so prompt caching stays warm — the retry loop is where the
// caching win materializes (origin §7.2).
//
// SCOPE: this loop retries only ACTIONABLE validation failures (a re-prompt can
// fix them). Transient provider errors (timeout, rate-limit, network) — which
// the AI SDK already backs off and retries internally — propagate as throws to
// the server boundary (T3-U10), where they become a user-facing failure; the
// loop does not catch them, because re-prompting cannot fix a rate limit.
import { type IRValidated, type ValidationError, type ValidationResult } from "../validator";

import { type GenerateDeps, type GenerateInput, generateSingle } from "./generate";
import { buildReprompt } from "./reprompt";
import { NOOP_SINK, type TelemetrySink, escapeAttemptOf } from "./telemetry";

/** Total attempts: 1 initial generation + 2 retries (origin §3.5 / Q12). */
export const RETRY_BUDGET = 3;

export interface RetryDeps extends GenerateDeps {
  /** Injected telemetry sink (T3-U5). Defaults to a no-op — telemetry is optional. */
  sink?: TelemetrySink;
  /** Injectable monotonic clock (ms) for the latency metric; defaults to performance.now. */
  now?: () => number;
}

export interface RetryOutcome {
  /** The final result: validated IR, or the legible §5.2 error list from the last attempt. */
  result: ValidationResult<IRValidated>;
  /** How many generation attempts were spent (1..RETRY_BUDGET). */
  attempts: number;
}

/**
 * Run the generation with bounded retries. Returns on the first success, or the
 * last attempt's legible error once the budget is exhausted — never a 4th call,
 * never an unvalidated object. Emits the three §7.1 metrics through the injected
 * sink: first-try-success (true only at attempt 1), an escape-attempt event per
 * failed attempt carrying a release-blocking invariant, and a latency event
 * (prompt-submit → IR-validated total, with the provider-inference share
 * separated as the sum of per-attempt generation time).
 */
export async function generateWithRetry(input: GenerateInput, deps: RetryDeps = {}): Promise<RetryOutcome> {
  const sink = deps.sink ?? NOOP_SINK;
  const now = deps.now ?? (() => performance.now());
  const generateDeps: GenerateDeps = { model: deps.model, sink };

  const start = now();
  let providerMs = 0;
  let lastErrors: ValidationError[] = [];

  for (let attempt = 1; attempt <= RETRY_BUDGET; attempt += 1) {
    // Retries re-prompt from the FULL prior error list; the final attempt adds
    // the pattern-only fallback.
    const correction =
      attempt === 1 ? undefined : buildReprompt(lastErrors, { patternOnly: attempt === RETRY_BUDGET });

    const attemptStart = now();
    const result = await generateSingle({ ...input, correction }, generateDeps);
    providerMs += now() - attemptStart;

    if (result.ok) {
      sink.emit({ kind: "first-try-success", success: attempt === 1 });
      sink.emit({ kind: "latency", totalMs: now() - start, providerMs, attempts: attempt });
      return { result, attempts: attempt };
    }

    const escape = escapeAttemptOf(result.errors);
    if (escape) sink.emit({ kind: "escape-attempt", invariant: escape.invariant, code: escape.code });
    lastErrors = result.errors;
  }

  sink.emit({ kind: "first-try-success", success: false });
  sink.emit({ kind: "latency", totalMs: now() - start, providerMs, attempts: RETRY_BUDGET });
  return { result: { ok: false, errors: lastErrors }, attempts: RETRY_BUDGET };
}
