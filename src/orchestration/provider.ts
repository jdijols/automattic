// T3-U1 — the provider seam (origin §4.1, ADR-0001). A provider-agnostic wrapper
// around the Vercel AI SDK `generateObject`: the default is Anthropic Sonnet, and
// switching providers is a ONE-LINE change to `defaultModel()` (e.g. swap
// `anthropic(...)` for `openai(...)`) — the schema, the call policy, and the
// result shape are untouched.
//
// Responsibilities this seam OWNS for every call (the R8 boundary obligations):
//   • `max_tokens` (`maxOutputTokens`) — never an unbounded generation.
//   • a request timeout — enforced as an `AbortSignal.timeout`, composed with any
//     caller-supplied signal, so a hung provider call cannot wedge the loop.
//   • structured-output strategy via the Anthropic PROVIDER OPTION
//     `structuredOutputMode` — NOT the dead v4-era `mode` parameter (#7791).
//   • 5-min-TTL prompt caching placed as a `cache_control` breakpoint ON THE
//     SYSTEM MESSAGE (Anthropic caches at content-block granularity, so a
//     call-level cacheControl is a no-op). The byte-stable T3-U2 prefix is the
//     system message and thus the cache target (origin §7.2).
//   • `NoObjectGeneratedError` is CAUGHT and surfaced as a structured failure
//     ({ cause, text, usage, finishReason }) for the T3-U3 repair/retry path —
//     never thrown past the caller. `finishReason` lets the repair path tell a
//     truncated generation (`"length"` → raise the cap) apart from a genuine
//     schema miss (`"error"`/`"stop"` → repair/re-prompt). ALL OTHER errors —
//     timeout/abort, rate-limit/`RetryError`, network, auth — propagate AS
//     THROWS (this seam invents no error taxonomy); the T3-U4 loop wraps this
//     call and converts those throws into its legible-error path.
//
// This module reimplements no validation: it produces an UNVALIDATED candidate
// (the generation view's inferred type). The candidate is gated by the Track-1
// `validateIR` before it is ever returned or assembled (wired in T3-U3).
import { createAnthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
import {
  NoObjectGeneratedError,
  type FinishReason,
  generateObject,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type RepairTextFunction,
} from "ai";
import type * as z from "zod";

/** The provider swap point. Change this line to swap the default provider/model. */
export const SONNET_MODEL_ID = "claude-sonnet-4-5";

/**
 * The canonical Anthropic REST base. PINNED explicitly (not left to the SDK
 * default) so a stray `ANTHROPIC_BASE_URL` in the environment cannot silently
 * break generation. The `@ai-sdk/anthropic` default IS this value — but when
 * `ANTHROPIC_BASE_URL` is set, the SDK uses it verbatim as the full base. Tools
 * like Claude for Desktop export `ANTHROPIC_BASE_URL=https://api.anthropic.com`
 * (no `/v1`), so the SDK then calls `…/messages` instead of `…/v1/messages` and
 * every request 404s → a generic 502 with no obvious cause. Passing an explicit
 * `baseURL` to `createAnthropic` overrides that env var (verified empirically),
 * making generation robust to a polluted local OR deployment environment. To
 * point at a proxy / Vercel AI Gateway, change THIS constant (one line).
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

/** Provider factory with the base URL pinned (env-override-proof). */
const provider = createAnthropic({ baseURL: ANTHROPIC_BASE_URL });

/** The default model: Anthropic Sonnet. One-line swap (origin §4.1, ADR-0001). */
export const defaultModel = (): LanguageModel => provider(SONNET_MODEL_ID);

/** Bounded output — the R8 obligation; never an unbounded generation. */
export const MAX_OUTPUT_TOKENS = 8192;

/** Default per-call timeout (ms). Enforced as an abort signal on every call. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Structured-output strategy, set via the Anthropic provider option (NOT the
 * dead v4 `mode`). "auto" lets the provider pick tool-vs-output-format.
 */
export const DEFAULT_STRUCTURED_OUTPUT_MODE = "auto" as const;

/** 5-minute ephemeral cache breakpoint TTL (origin §7.2). */
export const CACHE_CONTROL_5M = { type: "ephemeral", ttl: "5m" } as const;

export interface GenerateRequest {
  /** The fixed instruction segment (T3-U2 assembles the cacheable prefix here). */
  system?: string;
  /** The variable suffix — the delimited user-data slot lives here (T3-U2). */
  prompt: string;
  /** Override the model. Defaults to `defaultModel()` (Sonnet). */
  model?: LanguageModel;
  /** Override the output cap. Defaults to `MAX_OUTPUT_TOKENS`. */
  maxOutputTokens?: number;
  /** Override the timeout (ms). Defaults to `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Caller cancellation, composed with the timeout signal. */
  abortSignal?: AbortSignal;
  /** Malformed-JSON repair, passed through as `experimental_repairText` (T3-U3). */
  repairText?: RepairTextFunction;
  /** Per-call Anthropic provider options, merged OVER the secure defaults. */
  anthropic?: AnthropicProviderOptions;
}

export interface GenerateSuccess<T> {
  ok: true;
  object: T;
  usage: LanguageModelUsage;
}

export interface GenerateFailure {
  ok: false;
  reason: "no-object";
  /** The provider error cause — surfaced for the repair path; never re-thrown. */
  cause: unknown;
  /** The raw model text that failed to parse, for `experimental_repairText`. */
  text: string | undefined;
  usage: LanguageModelUsage | undefined;
  /** Distinguishes truncation (`"length"`) from a schema miss for the repair path. */
  finishReason: FinishReason | undefined;
}

export type GenerateOutcome<T> = GenerateSuccess<T> | GenerateFailure;

/** Compose the timeout signal with any caller-supplied abort signal. */
function callSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

/**
 * Run one `generateObject` call against the given schema, returning a validated
 * candidate-or-structured-failure outcome. The provider is a one-line swap; the
 * caller never sees a thrown `NoObjectGeneratedError`.
 */
export async function generateStructured<SCHEMA extends z.ZodType>(
  schema: SCHEMA,
  request: GenerateRequest,
): Promise<GenerateOutcome<z.infer<SCHEMA>>> {
  const timeoutMs = request.timeoutMs ?? REQUEST_TIMEOUT_MS;
  // Call-level Anthropic options: the structured-output strategy (and any caller
  // override). The cache breakpoint is NOT here — Anthropic caches at CONTENT-
  // BLOCK granularity, so a call-level cacheControl is a silent no-op. The 5m
  // breakpoint is placed on the system message below (the byte-stable prefix is
  // the cache target — origin §7.2).
  const callAnthropicOptions: AnthropicProviderOptions = {
    structuredOutputMode: DEFAULT_STRUCTURED_OUTPUT_MODE,
    ...request.anthropic,
  };

  // Build the message list so the system prefix carries the cache_control
  // breakpoint on its own block (the only placement Anthropic actually caches).
  const messages: ModelMessage[] = [];
  if (request.system !== undefined) {
    messages.push({
      role: "system",
      content: request.system,
      providerOptions: { anthropic: { cacheControl: CACHE_CONTROL_5M } },
    });
  }
  messages.push({ role: "user", content: request.prompt });

  try {
    const result = await generateObject({
      model: request.model ?? defaultModel(),
      schema,
      schemaName: "WordPressBlockThemeIR",
      schemaDescription: "A WordPress FSE block theme expressed as the published IR.",
      messages,
      maxOutputTokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      abortSignal: callSignal(timeoutMs, request.abortSignal),
      experimental_repairText: request.repairText,
      providerOptions: { anthropic: callAnthropicOptions },
    });
    // result.object is the schema's parsed output; the cast bridges the SDK's
    // generic inference to our `z.infer<SCHEMA>` outcome type.
    return { ok: true, object: result.object as z.infer<SCHEMA>, usage: result.usage };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Surface the malformed candidate for the repair/retry path (T3-U3/T3-U4).
      return {
        ok: false,
        reason: "no-object",
        cause: error.cause,
        text: error.text,
        usage: error.usage,
        finishReason: error.finishReason,
      };
    }
    // Transient/operational errors (timeout-abort, rate-limit/RetryError, network,
    // auth) and genuine bugs alike propagate here. This seam invents no error
    // taxonomy: the T3-U4 loop wraps this call and classifies the throw.
    throw error;
  }
}
