// T3-U5 — telemetry: the three Track-3 strategy metrics + the diversity proxy
// (origin §7.1, STRATEGY.md), emitted as STRUCTURED EVENTS through an injected
// sink. This module owns a PURE event-type contract: emitters (the T3-U4 loop)
// depend on the `TelemetrySink` interface defined here, and this module imports
// nothing from the loop — so there is no U4↔U5 cycle.
//
// Events are structured, never free-text logs of the prompt/response, and NEVER
// carry the API key or raw provider metadata. The one place a credential could
// leak — a NoObjectGeneratedError's `.cause` (which T3-U1 surfaces for the repair
// path) — is sanitized at ingestion by `sanitizeCause` BEFORE any metric is
// derived or any event emitted. This belt does not wait for the T3-U10 call-
// wrapper (origin §7.1 / deepening security P2).
import { type FinishReason } from "ai";

import { type ErrorCode, type Invariant, type ValidationError } from "../validator";

/** The three metrics + the diversity proxy + a sanitized failure diagnostic. */
export type TelemetryEvent =
  // first-try success: TRUE only when attempt 1 validated; success-after-retry is FALSE.
  | { kind: "first-try-success"; success: boolean }
  // an escape attempt: a rejection carrying a release-blocking invariant (a per-ATTEMPT
  // trend signal — one event per failed attempt, keyed on the first escape invariant found).
  | { kind: "escape-attempt"; invariant: Invariant; code: ErrorCode }
  // wall-clock prompt-submit → IR-validated, with the provider-inference share separated.
  | { kind: "latency"; totalMs: number; providerMs: number; attempts: number }
  // distinctiveness across N generations (lower ⇒ more repetition).
  | { kind: "diversity"; sampleSize: number; distinctPatterns: number; distinctCompositions: number }
  // a malformed-output failure (no parseable IR). `cause` is ALWAYS sanitized at the
  // ingestion point (generateSingle), so it can never carry a credential.
  | { kind: "generation-failed"; finishReason: FinishReason | undefined; cause: unknown };

/** The injected sink. Emitters depend on THIS interface, never an implementation. */
export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}

/** Default sink: drops every event (telemetry is optional and side-effect-free by default). */
export const NOOP_SINK: TelemetrySink = { emit: () => undefined };

/** An in-memory sink that records events — for composition roots and tests. */
export class CollectingSink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  emit(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

// The release-blocking invariant classes that make a rejection an ESCAPE ATTEMPT
// (a steered model trying to emit something disqualifying), as opposed to an
// ordinary structural mistake. Driven by the published §5.2 invariant tag — NOT
// by validator internals.
const ESCAPE_INVARIANTS: ReadonlySet<Invariant> = new Set<Invariant>([
  "wp-html",
  "hallucinated-block-name",
  "invalid-theme-json",
]);

/**
 * The first error in the list that carries a release-blocking invariant, or null
 * if the failure is an ordinary structural mistake (e.g. a containment error).
 */
export function escapeAttemptOf(
  errors: readonly ValidationError[],
): { invariant: Invariant; code: ErrorCode } | null {
  for (const error of errors) {
    if (error.invariant !== null && ESCAPE_INVARIANTS.has(error.invariant)) {
      return { invariant: error.invariant, code: error.code };
    }
  }
  return null;
}

// Field names (case-insensitive) whose values must never enter telemetry.
const CREDENTIAL_KEYS = new Set([
  "authorization",
  "api-key",
  "apikey",
  "x-api-key",
  "cookie",
  "set-cookie",
  "token",
  "secret",
  "password",
]);
const REDACTED = "[redacted]";
const MAX_SANITIZE_DEPTH = 8;

// Value-borne credential patterns (secrets carried in a STRING value, not a key):
// `Bearer <token>`, and `authorization|api-key|token|secret|password = <value>`
// (as in an error message or a URL query). Key-based redaction alone misses these.
const BEARER_RE = /(bearer\s+)\S+/gi;
const KV_SECRET_RE = /((?:authorization|api[-_]?key|token|secret|password)\s*[:=]\s*)\S+/gi;
// Provider API-key shapes (Anthropic/OpenAI: `sk-ant-…`, `sk-…`) — redacted even
// when they appear bare in a message with no preceding label.
const KEY_SHAPE_RE = /sk-[a-z0-9-]{8,}/gi;

function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, `$1${REDACTED}`)
    .replace(KV_SECRET_RE, `$1${REDACTED}`)
    .replace(KEY_SHAPE_RE, REDACTED);
}

/**
 * Return a credential-safe copy of a provider-error cause so derived metrics /
 * emitted events can never carry an API key or `Authorization` header. Defends
 * three shapes a real provider `.cause` takes: (a) plain objects (redact
 * credential KEYS); (b) string values carrying a secret (scrub Bearer/k=v
 * patterns — catches secrets in URLs and messages); (c) Error instances (whose
 * `message`/`stack` are non-enumerable, so `Object.entries` would miss them) —
 * captured explicitly and scrubbed. Bounded depth guards pathological nesting.
 */
export function sanitizeCause(cause: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return REDACTED;
  if (typeof cause === "string") return scrubString(cause);
  if (cause instanceof Error) {
    return { name: cause.name, message: scrubString(cause.message) };
  }
  if (Array.isArray(cause)) return cause.map((item) => sanitizeCause(item, depth + 1));
  if (cause !== null && typeof cause === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cause)) {
      out[key] = CREDENTIAL_KEYS.has(key.toLowerCase()) ? REDACTED : sanitizeCause(value, depth + 1);
    }
    return out;
  }
  return cause;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collect pattern slugs from a node tree (for the distinct-pattern count). */
function collectSlugs(nodes: readonly unknown[], slugs: string[]): void {
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (typeof node.pattern === "string") slugs.push(node.pattern);
    else if (Array.isArray(node.innerBlocks)) collectSlugs(node.innerBlocks, slugs);
  }
}

/**
 * Build an ORDER- and NESTING-preserving structural signature for one node list.
 * `B:core/group(B:core/heading)` differs from `B:core/group,B:core/heading`, and
 * `[A,B]` differs from `[B,A]` — so genuinely distinct layouts never collide.
 */
function compositionSig(nodes: readonly unknown[]): string {
  return nodes
    .map((node) => {
      if (!isRecord(node)) return "?";
      if (typeof node.pattern === "string") return `P:${node.pattern}`;
      if (typeof node.block === "string") {
        const inner = Array.isArray(node.innerBlocks) ? `(${compositionSig(node.innerBlocks)})` : "";
        return `B:${node.block}${inner}`;
      }
      return "?";
    })
    .join(",");
}

/**
 * The diversity proxy across N generations: the count of distinct pattern slugs
 * and the count of distinct composition signatures (order- and nesting-aware,
 * per region in order). Repeated single-pattern output yields low distinctness;
 * varied output yields high (origin §7.1 derived diversity proxy).
 */
export function diversityProxy(
  generations: readonly { regions: readonly { name?: string; content: readonly unknown[] }[] }[],
): { sampleSize: number; distinctPatterns: number; distinctCompositions: number } {
  const patternSlugs = new Set<string>();
  const compositions = new Set<string>();
  for (const ir of generations) {
    const slugs: string[] = [];
    const regionSigs: string[] = [];
    for (const region of ir.regions) {
      collectSlugs(region.content, slugs);
      regionSigs.push(`${region.name ?? ""}:[${compositionSig(region.content)}]`);
    }
    slugs.forEach((slug) => patternSlugs.add(slug));
    compositions.add(regionSigs.join("|"));
  }
  return {
    sampleSize: generations.length,
    distinctPatterns: patternSlugs.size,
    distinctCompositions: compositions.size,
  };
}
