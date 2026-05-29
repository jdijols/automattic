// T3-U10 — the operational-security surface (origin Q16): the abuse/cost +
// secrets boundary at the Track-3 server seam. This module owns the four guards
// the `app/api/generate/route.ts` handler applies IN ORDER, before any provider
// call:
//   1. throttle      — per-client rate limit (cheap, runs first).
//   2. input cap     — the NL-description length cap, enforced BEFORE prompt
//                      construction (supersedes the Track-1 U1 placeholder).
//   3. spend guard   — a bounded provider budget that FAILS CLOSED once exceeded.
//   4. sanitization  — every provider error is credential-scrubbed before it can
//                      reach a log, the telemetry sink, a hint, or the response.
//
// Secrets policy: the single `ANTHROPIC_API_KEY` is read server-side only (by the
// provider inside generateTheme), never referenced here or in the route, and
// never logged — `sanitizeForLog` strips it from any error that does carry it.
import { type GenerationResult } from "./contract";
import { type GenerateInput } from "./generate";
import { structuredCriteriaSchema } from "./prompt";
import { sanitizeCause } from "./telemetry";

/** Max natural-language description length (chars) accepted before prompt build. */
export const INPUT_MAX_LENGTH = 4000;

/** Credential-scrubbing for anything that may be logged (reuses the T3-U5 belt). */
export const sanitizeForLog = sanitizeCause;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fixed-window per-key rate limiter. The `clientId` key is an attacker-spoofable
 * header (X-Forwarded-For), so the tracking Map is bounded: when it overflows
 * `maxKeys`, fully-expired keys are swept, preventing unbounded memory growth
 * from a flood of forged keys. Injectable clock for deterministic tests.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 50_000,
  ) {}

  tryAcquire(key: string): boolean {
    const t = this.now();
    if (this.hits.size > this.maxKeys) this.sweepExpired(t);
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  private sweepExpired(t: number): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((ts) => t - ts >= this.windowMs)) this.hits.delete(key);
    }
  }

  /** Number of distinct keys currently tracked (for the memory-bound test / ops). */
  get trackedKeys(): number {
    return this.hits.size;
  }
}

/** A bounded provider-spend budget. Reservations FAIL CLOSED once exhausted. */
export class SpendGuard {
  private spent = 0;
  constructor(private readonly budget: number) {}

  tryReserve(cost = 1): boolean {
    if (this.spent + cost > this.budget) return false; // fail closed — never over-spend
    this.spent += cost;
    return true;
  }

  /** Refund a reservation — used when a call failed WITHOUT a billable provider charge. */
  release(cost = 1): void {
    this.spent = Math.max(0, this.spent - cost);
  }

  get remaining(): number {
    return Math.max(0, this.budget - this.spent);
  }
}

export interface GenerateHandlerDeps {
  /** Per-user/per-IP identity for throttling. */
  clientId: string;
  rateLimiter: RateLimiter;
  spendGuard: SpendGuard;
  /** The generation entry point (T3-U6 generateTheme), injected for testability. */
  generate: (input: GenerateInput) => Promise<GenerationResult>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
  /** A sanitized log record the caller MAY emit — never carries a credential. */
  log?: { event: string; detail: unknown };
}

/**
 * The Track-3 server-seam handler: throttle → input cap → spend guard → generate,
 * with provider errors credential-scrubbed. Returns a status + JSON-safe body
 * (and an optional sanitized log record). Never echoes a prompt, provider name,
 * key, or raw provider metadata.
 */
export async function handleGenerateRequest(rawBody: unknown, deps: GenerateHandlerDeps): Promise<HandlerResult> {
  // 1. Throttle (before anything expensive).
  if (!deps.rateLimiter.tryAcquire(deps.clientId)) {
    return { status: 429, body: { error: "rate_limited" } };
  }

  // 2. Parse + 2b. input cap — BEFORE prompt construction (no generate call yet).
  if (!isRecord(rawBody) || typeof rawBody.userDescription !== "string") {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const userDescription = rawBody.userDescription;
  if (userDescription.length > INPUT_MAX_LENGTH) {
    return { status: 400, body: { error: "input_too_long", maxLength: INPUT_MAX_LENGTH } };
  }

  // 2c. Criteria are bounded + typed at THIS boundary (strictObject + field
  // regexes), so an oversized/hostile criteria object is a 400 here — not a
  // misclassified 502 from a buildPrompt throw deep in generation, and not a
  // wasted spend reservation.
  const criteria = structuredCriteriaSchema.safeParse(rawBody.criteria ?? {});
  if (!criteria.success) {
    return { status: 400, body: { error: "invalid_criteria" } };
  }

  // 3. Spend guard — fail closed (debited AFTER input validation passes).
  if (!deps.spendGuard.tryReserve()) {
    return { status: 503, body: { error: "capacity_exhausted" } };
  }

  const input: GenerateInput = { userDescription, criteria: criteria.data };
  try {
    const result = await deps.generate(input);
    // A returned result (done OR failed) means the provider ran — keep the debit.
    return result.status === "done"
      ? { status: 200, body: { status: "done", ir: result.ir } }
      : { status: 422, body: { status: "failed", errors: result.errors } };
  } catch (error) {
    // 4. A provider/transient error (e.g. a 401 carrying request metadata) is
    // scrubbed before it can reach a log; the response body stays generic. The
    // reservation is REFUNDED so forced transient failures cannot drain the
    // budget into a self-inflicted denial of service.
    deps.spendGuard.release();
    return {
      status: 502,
      body: { error: "generation_failed" },
      log: { event: "generation_error", detail: sanitizeForLog(error) },
    };
  }
}
