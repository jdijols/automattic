import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { generateSingle, repairJsonText } from "../../src/orchestration/generate";
import { CollectingSink } from "../../src/orchestration/telemetry";

// Real validator (layers 1–3 have landed) — no fake-validator stub.
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

/** A mock model that returns fixed text; generateObject does the real parsing/repair. */
function model(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage,
      warnings: [],
    }),
  });
}

const INPUT = { userDescription: "A clean blog." };

// Envelope-valid IRs that the generation view accepts but the validator judges.
const HALLUCINATED = {
  irVersion: 1,
  theme: { slug: "x-theme", title: "X" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/totally-made-up" }] }],
};
const HOSTILE_URL = {
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
};

describe("repairJsonText", () => {
  it("strips a markdown fence and trims to the outermost object", () => {
    expect(repairJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(repairJsonText('prose before {"a":1} prose after')).toBe('{"a":1}');
  });
  it("returns null when there is no object to recover", () => {
    expect(repairJsonText("totally not json")).toBeNull();
    expect(repairJsonText("only an open { brace")).toBeNull();
  });
});

describe("generateSingle — C-single (T3-U3)", () => {
  it("happy path: a valid IR candidate is returned as validated IR", async () => {
    const result = await generateSingle(INPUT, { model: model(JSON.stringify(blogInput())) });
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : null, null, 2)).toBe(true);
    if (result.ok) expect(result.value.regions.length).toBeGreaterThan(0);
  });

  it("a fenced (malformed) but valid candidate is repaired, then validated to success", async () => {
    const fenced = "```json\n" + JSON.stringify(blogInput()) + "\n```";
    const result = await generateSingle(INPUT, { model: model(fenced) });
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : null, null, 2)).toBe(true);
  });

  it("repair is not a gate-skip: a repaired-but-invalid candidate still fails validation", async () => {
    const fenced = "```json\n" + JSON.stringify(HALLUCINATED) + "\n```";
    const result = await generateSingle(INPUT, { model: model(fenced) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === "BLOCK_NOT_ALLOWED")).toBe(true);
  });

  it("a repaired candidate carrying a javascript: URL is still caught by the validator", async () => {
    const fenced = "```json\n" + JSON.stringify(HOSTILE_URL) + "\n```";
    const result = await generateSingle(INPUT, { model: model(fenced) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === "ATTRIBUTE_UNSAFE_URL")).toBe(true);
  });

  it("relays the validator's full multi-error list, not just the first error", async () => {
    const twoBad = {
      irVersion: 1,
      theme: { slug: "x-theme", title: "X" },
      tokens: {},
      regions: [
        { kind: "template", name: "index", content: [{ block: "core/made-up-one" }, { block: "core/made-up-two" }] },
      ],
    };
    const result = await generateSingle(INPUT, { model: model(JSON.stringify(twoBad)) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((e) => e.code === "BLOCK_NOT_ALLOWED").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("unrepairable model output yields a legible MALFORMED_INPUT error, not a thrown exception", async () => {
    const result = await generateSingle(INPUT, { model: model("the theme should be nice and blue") });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("MALFORMED_INPUT");
      expect(result.errors[0]!.message).not.toMatch(/zod|ajv|\{/i); // no raw internals
    }
  });

  describe("boundaries that propagate to their owning layer (not silently swallowed)", () => {
    it("a transient provider error propagates as a throw for the T3-U4 loop to classify", async () => {
      const boom = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("rate limited");
        },
      });
      await expect(generateSingle(INPUT, { model: boom })).rejects.toThrow("rate limited");
    });

    it("invalid caller-supplied criteria throw (validated at the T3-U10 input boundary)", async () => {
      await expect(
        generateSingle(
          { userDescription: "x", criteria: { siteType: "spaceship" } as never },
          { model: model(JSON.stringify(blogInput())) },
        ),
      ).rejects.toThrow(/criteria/i);
    });
  });

  it("sanitizes a NoObjectGeneratedError.cause at the telemetry ingestion point (no credential leaks)", async () => {
    // A provider error whose cause carries an Authorization Bearer token.
    const leaky = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new NoObjectGeneratedError({
          message: "no object",
          cause: new Error("401: Authorization: Bearer sk-leak-abc123"),
          text: "garbage",
          response: { id: "r", modelId: "m", timestamp: new Date(0) },
          usage: {
            inputTokens: 1,
            inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            outputTokens: 0,
            outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
            totalTokens: 1,
          },
          finishReason: "error",
        });
      },
    });
    const sink = new CollectingSink();
    const result = await generateSingle(INPUT, { model: leaky, sink });

    expect(result.ok).toBe(false); // surfaced as MALFORMED_INPUT, not thrown
    const failure = sink.events.find((e) => e.kind === "generation-failed");
    expect(failure).toBeDefined();
    // The Bearer token must NOT survive into any emitted event.
    expect(JSON.stringify(sink.events)).not.toContain("sk-leak-abc123");
  });
});
