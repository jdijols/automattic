import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import {
  CACHE_CONTROL_5M,
  DEFAULT_STRUCTURED_OUTPUT_MODE,
  MAX_OUTPUT_TOKENS,
  SONNET_MODEL_ID,
  defaultModel,
  generateStructured,
} from "../../src/orchestration/provider";

import { irGenerationSchema } from "../../src/orchestration/ir-views";

const VALID_IR = {
  irVersion: 1,
  theme: { slug: "mock-theme", title: "Mock" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/paragraph", text: "Hi" }] }],
};

// The low-level V3 provider usage/finishReason shapes the SDK maps to the
// top-level result (input.total 10 + output.total 20 → totalTokens 30).
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function model(text: string, meta?: { provider?: string; modelId?: string }): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: meta?.provider ?? "mock.provider",
    modelId: meta?.modelId ?? "mock-model",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage,
      warnings: [],
    }),
  });
}

describe("provider seam (T3-U1)", () => {
  describe("happy path", () => {
    it("returns the parsed object plus usage on success", async () => {
      const result = await generateStructured(irGenerationSchema, {
        prompt: "build a theme",
        model: model(JSON.stringify(VALID_IR)),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.object.theme.slug).toBe("mock-theme");
        expect(result.object.theme.wpVersionTarget).toBe("6.6"); // default applied
        expect(result.usage.totalTokens).toBe(30);
      }
    });
  });

  describe("provider-agnostic (swapping the model changes only the provider)", () => {
    it("two different mocked providers yield the identical result shape", async () => {
      const anthropicLike = model(JSON.stringify(VALID_IR), { provider: "anthropic.messages", modelId: "claude-x" });
      const openaiLike = model(JSON.stringify(VALID_IR), { provider: "openai.responses", modelId: "gpt-x" });

      const a = await generateStructured(irGenerationSchema, { prompt: "x", model: anthropicLike });
      const b = await generateStructured(irGenerationSchema, { prompt: "x", model: openaiLike });

      // Each passed model was the one actually invoked (proves the swap point is
      // honored, not that the harness merely echoes a shared canned response).
      expect(anthropicLike.doGenerateCalls).toHaveLength(1);
      expect(openaiLike.doGenerateCalls).toHaveLength(1);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (a.ok && b.ok) expect(a.object).toEqual(b.object);
    });

    it("the default model is Sonnet on Anthropic — the one-line swap point", () => {
      const m = defaultModel();
      expect(typeof m).not.toBe("string");
      if (typeof m !== "string") {
        expect(m.modelId).toBe(SONNET_MODEL_ID);
        expect(m.provider).toContain("anthropic");
      }
    });
  });

  describe("every call sets the R8 boundary obligations", () => {
    it("forwards max_tokens, a timeout-derived abort signal, structuredOutputMode and 5m caching", async () => {
      const m = model(JSON.stringify(VALID_IR));
      await generateStructured(irGenerationSchema, { prompt: "x", model: m });

      const call = m.doGenerateCalls[0];
      expect(call).toBeDefined();
      expect(call!.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
      expect(call!.abortSignal).toBeInstanceOf(AbortSignal); // timeout wires an abort signal
      expect(call!.providerOptions?.anthropic).toMatchObject({
        structuredOutputMode: DEFAULT_STRUCTURED_OUTPUT_MODE,
        cacheControl: CACHE_CONTROL_5M,
      });
    });

    it("caller-supplied anthropic provider options merge over the secure defaults", async () => {
      const m = model(JSON.stringify(VALID_IR));
      await generateStructured(irGenerationSchema, {
        prompt: "x",
        model: m,
        maxOutputTokens: 1234,
        anthropic: { structuredOutputMode: "jsonTool" },
      });
      const call = m.doGenerateCalls[0];
      expect(call!.maxOutputTokens).toBe(1234);
      expect(call!.providerOptions?.anthropic).toMatchObject({
        structuredOutputMode: "jsonTool", // overridden
        cacheControl: CACHE_CONTROL_5M, // default retained
      });
    });
  });

  describe("NoObjectGeneratedError is caught and surfaced, never thrown past the caller", () => {
    it("returns a structured failure exposing cause + text for the repair path", async () => {
      const badText = JSON.stringify({ irVersion: 999, not: "an ir" });
      const result = await generateStructured(irGenerationSchema, {
        prompt: "x",
        model: model(badText),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("no-object");
        expect(result.text).toBe(badText); // raw model text, for experimental_repairText
        expect(result.cause).toBeDefined();
        expect(result.finishReason).toBeDefined(); // truncation-vs-schema-miss signal
      }
    });

    it("forwards experimental_repairText, which can rescue a malformed candidate", async () => {
      // The model emits unparseable text; the repair function returns valid IR
      // JSON, which generateObject then parses — proving the option is wired.
      let repairCalled = false;
      const result = await generateStructured(irGenerationSchema, {
        prompt: "x",
        model: model("this is not json at all"),
        repairText: async () => {
          repairCalled = true;
          return JSON.stringify(VALID_IR);
        },
      });
      expect(repairCalled).toBe(true);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.object.theme.slug).toBe("mock-theme");
    });

    it("re-throws non-NoObjectGeneratedError failures (does not swallow real bugs)", async () => {
      const boom = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("network down");
        },
      });
      await expect(generateStructured(irGenerationSchema, { prompt: "x", model: boom })).rejects.toThrow(
        "network down",
      );
    });
  });
});
