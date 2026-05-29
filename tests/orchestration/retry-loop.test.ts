import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { RETRY_BUDGET, generateWithRetry } from "../../src/orchestration/retry-loop";

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
