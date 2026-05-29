import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { RETRY_BUDGET, generateWithRetry } from "../../src/orchestration/retry-loop";
import { CollectingSink, type TelemetryEvent } from "../../src/orchestration/telemetry";

const blogInput = (): unknown => {
  const blog = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../fixtures/positive/blog/blog.json", import.meta.url)), "utf8"),
  ) as { input: unknown };
  return blog.input;
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

/** A mock that returns the i-th text on the i-th call (clamped to the last). */
function sequenceModel(texts: string[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const text = texts[Math.min(i, texts.length - 1)]!;
      i += 1;
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
}

const HALLUCINATED = JSON.stringify({
  irVersion: 1,
  theme: { slug: "x-theme", title: "X" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/made-up" }] }],
});
const WP_HTML = JSON.stringify({
  irVersion: 1,
  theme: { slug: "x-theme", title: "X" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/html", attributes: {} }] }],
});
const HOSTILE_URL = JSON.stringify({
  irVersion: 1,
  theme: { slug: "x-theme", title: "X" },
  tokens: {},
  regions: [
    {
      kind: "template",
      name: "index",
      content: [{ block: "core/buttons", innerBlocks: [{ block: "core/button", attributes: { url: "javascript:alert(1)" } }] }],
    },
  ],
});

const INPUT = { userDescription: "A clean blog." };

// Extract ONLY the user-message text of a given call (where the correction
// lives), so substring assertions can't false-match the byte-stable system prefix.
const userPromptText = (model: MockLanguageModelV3, callIndex: number): string => {
  const message = model.doGenerateCalls[callIndex]?.prompt.find((m) => m.role === "user");
  if (!message) return "";
  const { content } = message;
  if (typeof content === "string") return content;
  return content.map((part) => ("text" in part ? part.text : "")).join("");
};

describe("generateWithRetry (T3-U4)", () => {
  it("first-try success returns after exactly one attempt, with no correction", async () => {
    const model = sequenceModel([JSON.stringify(blogInput())]);
    const { result, attempts } = await generateWithRetry(INPUT, { model });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(userPromptText(model, 0)).not.toContain("failed validation");
  });

  it("returns the IR after exactly one retry on fail→pass", async () => {
    const model = sequenceModel([HALLUCINATED, JSON.stringify(blogInput())]);
    const { result, attempts } = await generateWithRetry(INPUT, { model });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("returns the legible error after exactly 3 attempts on fail×3 — never a 4th call", async () => {
    const model = sequenceModel([HALLUCINATED]); // every attempt fails
    const { result, attempts } = await generateWithRetry(INPUT, { model });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(RETRY_BUDGET);
    expect(model.doGenerateCalls).toHaveLength(3); // no 4th call
    if (!result.ok) expect(result.errors.some((e) => e.code === "BLOCK_NOT_ALLOWED")).toBe(true);
  });

  it("re-prompts retries with the correction (first attempt has none)", async () => {
    const model = sequenceModel([HALLUCINATED]);
    await generateWithRetry(INPUT, { model });
    expect(userPromptText(model, 0)).not.toContain("failed validation"); // initial attempt is clean
    expect(userPromptText(model, 1)).toContain("failed validation"); // retry carries the correction
    expect(userPromptText(model, 1)).toContain("BLOCK_NOT_ALLOWED");
  });

  it("carries the FULL multi-error list into the retry correction (anti-oscillation)", async () => {
    // One candidate that fails with TWO distinct codes in a single validateIR pass.
    const twoCodes = JSON.stringify({
      irVersion: 1,
      theme: { slug: "x-theme", title: "X" },
      tokens: {},
      regions: [
        {
          kind: "template",
          name: "index",
          content: [{ block: "core/made-up" }, { block: "core/heading", attributes: { level: 9 } }],
        },
      ],
    });
    const model = sequenceModel([twoCodes]);
    await generateWithRetry(INPUT, { model });
    const retry = userPromptText(model, 1);
    expect(retry).toContain("BLOCK_NOT_ALLOWED");
    expect(retry).toContain("ATTRIBUTE_OUT_OF_RANGE"); // both errors forwarded, not just the first
  });

  it("applies the pattern-only fallback on the final attempt only", async () => {
    const model = sequenceModel([HALLUCINATED]);
    await generateWithRetry(INPUT, { model });
    expect(userPromptText(model, 1)).not.toContain("ONLY from catalog pattern references"); // retry 1
    expect(userPromptText(model, 2)).toContain("ONLY from catalog pattern references"); // final attempt
  });

  it("still catches a hostile value across 3 attempts that each survive repair", async () => {
    // Each attempt returns a FENCED (raw-unparseable) IR carrying a javascript:
    // URL. Reaching ATTRIBUTE_UNSAFE_URL (rather than MALFORMED_INPUT) proves the
    // repair recovered the JSON each time — yet the validator still rejects it.
    const fenced = "```json\n" + HOSTILE_URL + "\n```";
    const model = sequenceModel([fenced]);
    const { result, attempts } = await generateWithRetry(INPUT, { model });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(RETRY_BUDGET);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "ATTRIBUTE_UNSAFE_URL")).toBe(true);
      expect(result.errors.some((e) => e.code === "MALFORMED_INPUT")).toBe(false); // repair succeeded
    }
  });
});

describe("generateWithRetry — telemetry (T3-U5)", () => {
  const one = <K extends TelemetryEvent["kind"]>(sink: CollectingSink, kind: K): Extract<TelemetryEvent, { kind: K }> =>
    sink.events.find((e) => e.kind === kind) as Extract<TelemetryEvent, { kind: K }>;

  it("counts first-try-success at attempt 1 (true), and success-after-retry as false", async () => {
    const win = new CollectingSink();
    await generateWithRetry(INPUT, { model: sequenceModel([JSON.stringify(blogInput())]), sink: win });
    expect(one(win, "first-try-success").success).toBe(true);

    const afterRetry = new CollectingSink();
    await generateWithRetry(INPUT, {
      model: sequenceModel([HALLUCINATED, JSON.stringify(blogInput())]),
      sink: afterRetry,
    });
    expect(one(afterRetry, "first-try-success").success).toBe(false);
  });

  it("emits an escape-attempt (wp-html) for a core/html rejection, but not for a plain containment error", async () => {
    const escape = new CollectingSink();
    await generateWithRetry(INPUT, { model: sequenceModel([WP_HTML]), sink: escape });
    const events = escape.events.filter((e) => e.kind === "escape-attempt");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ kind: "escape-attempt", invariant: "wp-html" });

    // HALLUCINATED → "hallucinated-block-name" IS an escape; a containment-only
    // failure would not be. Verify the wp-html path is invariant-driven, not code-driven.
    const plain = new CollectingSink();
    await generateWithRetry(INPUT, { model: sequenceModel([HOSTILE_URL]), sink: plain }); // ATTRIBUTE_UNSAFE_URL, invariant null
    expect(plain.events.some((e) => e.kind === "escape-attempt")).toBe(false);
  });

  it("emits a latency event with the provider-inference share strictly separated from total", async () => {
    let t = 0;
    const sink = new CollectingSink();
    // Deterministic clock advancing 5ms/call: start=5, attemptStart=10, attemptEnd=15,
    // totalEnd=20 → providerMs=5, totalMs=15. Provider share is a STRICT subset of total.
    await generateWithRetry(INPUT, {
      model: sequenceModel([JSON.stringify(blogInput())]),
      sink,
      now: () => (t += 5),
    });
    const latency = one(sink, "latency");
    expect(latency.providerMs).toBe(5);
    expect(latency.totalMs).toBe(15);
    expect(latency.providerMs).toBeLessThan(latency.totalMs); // separation, not a duplicate of total
    expect(latency.attempts).toBe(1);
  });

  it("exhaustion path (fail×3) emits exactly one first-try-success(false), one latency, and a hallucinated escape per attempt", async () => {
    const sink = new CollectingSink();
    await generateWithRetry(INPUT, { model: sequenceModel([HALLUCINATED]), sink });
    expect(sink.events.filter((e) => e.kind === "first-try-success")).toEqual([{ kind: "first-try-success", success: false }]);
    expect(sink.events.filter((e) => e.kind === "latency")).toHaveLength(1);
    const escapes = sink.events.filter((e) => e.kind === "escape-attempt");
    expect(escapes).toHaveLength(RETRY_BUDGET); // one per failed attempt
    expect(escapes.every((e) => e.kind === "escape-attempt" && e.invariant === "hallucinated-block-name")).toBe(true);
  });
});
