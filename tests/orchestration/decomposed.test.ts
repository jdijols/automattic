import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { REGION_CONCURRENCY, generateDecomposed } from "../../src/orchestration/decomposed";
import { generateTheme } from "../../src/orchestration/index";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
});

// Extract the user-message text from a V3 prompt (where the per-call task lives).
const userText = (prompt: readonly { role: string; content: unknown }[]): string => {
  const message = prompt.find((m) => m.role === "user");
  if (!message) return "";
  const { content } = message;
  if (typeof content === "string") return content;
  return (content as { text?: string }[]).map((p) => p.text ?? "").join("");
};
const systemText = (prompt: readonly { role: string; content: unknown }[]): string => {
  const message = prompt.find((m) => m.role === "system");
  return typeof message?.content === "string" ? message.content : "";
};

const ENVELOPE = JSON.stringify({
  irVersion: 1,
  theme: { slug: "d-theme", title: "D" },
  tokens: {},
  regions: [
    { kind: "template", name: "index" },
    { kind: "template", name: "single" },
    { kind: "template", name: "archive" },
  ],
});
const REGION_CONTENT = JSON.stringify({ content: [{ block: "core/paragraph", text: "hello" }] });

const INPUT = { userDescription: "A clean blog." };
const isEnvelope = (prompt: readonly { role: string; content: unknown }[]): boolean =>
  userText(prompt).includes("theme envelope");

const maxDepth = (nodes: readonly unknown[], depth = 1): number => {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, depth);
    const inner = (node as { innerBlocks?: unknown[] }).innerBlocks;
    if (Array.isArray(inner) && inner.length > 0) max = Math.max(max, maxDepth(inner, depth + 1));
  }
  return max;
};

describe("generateDecomposed — C-decomposed escalation arm (T3-U7)", () => {
  it("generates envelope + per-region trees and assembles to a valid IR", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => textResult(isEnvelope(options.prompt) ? ENVELOPE : REGION_CONTENT),
    });
    const { result } = await generateDecomposed(INPUT, { model });
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : null, null, 2)).toBe(true);
    if (result.ok) {
      expect(result.value.regions).toHaveLength(3);
      expect(result.value.regions.every((r) => r.content.length > 0)).toBe(true);
    }
  });

  it("dispatches region calls in parallel under bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        if (isEnvelope(options.prompt)) return textResult(ENVELOPE);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
        return textResult(REGION_CONTENT);
      },
    });
    await generateDecomposed(INPUT, { model });
    expect(maxActive).toBeGreaterThan(1); // genuinely parallel, not sequential
    expect(maxActive).toBeLessThanOrEqual(REGION_CONCURRENCY); // but bounded
  });

  it("caps in-flight region calls at REGION_CONCURRENCY when regions exceed the limit", async () => {
    const sixRegions = JSON.stringify({
      irVersion: 1,
      theme: { slug: "d-theme", title: "D" },
      tokens: {},
      regions: ["index", "single", "archive", "page", "home", "404"].map((name) => ({ kind: "template", name })),
    });
    let active = 0;
    let maxActive = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        if (isEnvelope(options.prompt)) return textResult(sixRegions);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
        return textResult(REGION_CONTENT);
      },
    });
    await generateDecomposed(INPUT, { model });
    expect(maxActive).toBe(REGION_CONCURRENCY); // 6 regions, 4 slots → peak is exactly the cap
  });

  it("uses an identical static system prefix across the envelope and every region call", async () => {
    const systems: string[] = [];
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        systems.push(systemText(options.prompt));
        return textResult(isEnvelope(options.prompt) ? ENVELOPE : REGION_CONTENT);
      },
    });
    await generateDecomposed(INPUT, { model });
    expect(systems.length).toBe(4); // envelope + 3 regions
    expect(new Set(systems).size).toBe(1); // byte-identical prefix (cache precondition)
  });

  it("fail-fast: a region exhausting its budget fails the whole IR and aborts in-flight siblings", async () => {
    // The "single" region always returns unparseable JSON (exhausts its budget).
    // The other regions BLOCK until aborted — so the test only COMPLETES if
    // fail-fast actually aborts them; otherwise it hangs and times out.
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        if (isEnvelope(options.prompt)) return textResult(ENVELOPE);
        if (userText(options.prompt).includes('"single"')) return textResult("not parseable json");
        await new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return textResult(REGION_CONTENT); // unreachable unless never aborted
      },
    });
    const { result } = await generateDecomposed(INPUT, { model });
    expect(result.ok).toBe(false); // no partial IR escapes
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "MALFORMED_INPUT" && e.path === "regions/single")).toBe(true);
    }
  });

  it("fails fast when the envelope itself cannot be parsed", async () => {
    const model = new MockLanguageModelV3({ doGenerate: async () => textResult("not an envelope") });
    const { result } = await generateDecomposed(INPUT, { model });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe("envelope");
  });

  it("the assembled whole-IR gate catches a cross-region violation regions cannot see alone", async () => {
    // Each region is generated in isolation and independently emits a level-1
    // heading; only the assembled-whole validateIR can catch the resulting
    // MULTIPLE_H1 — proving the gate runs on the composed IR, not per region.
    const h1Region = JSON.stringify({ content: [{ block: "core/heading", attributes: { level: 1 }, text: "Title" }] });
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => textResult(isEnvelope(options.prompt) ? ENVELOPE : h1Region),
    });
    const { result } = await generateDecomposed(INPUT, { model });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === "MULTIPLE_H1")).toBe(true);
  });

  it("plugs into the T3-U6 arm-selection seam (the escalate branch is wired)", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => textResult(isEnvelope(options.prompt) ? ENVELOPE : REGION_CONTENT),
    });
    // generateTheme flips to C-decomposed via the single arm config point.
    const result = await generateTheme(INPUT, { arm: generateDecomposed, model });
    expect(result.status).toBe("done");
  });
});

describe("decomposition yields shallower trees than the monolithic equivalent (T3-U7, structural)", () => {
  it("the ARM's assembled IR does not compound per-region depth, unlike a monolithic nesting", async () => {
    // A depth-2 section tree (group → heading) for each region.
    const section = { block: "core/group", innerBlocks: [{ block: "core/heading", text: "x" }] };
    const sectionContent = JSON.stringify({ content: [section] });
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => textResult(isEnvelope(options.prompt) ? ENVELOPE : sectionContent),
    });

    const { result } = await generateDecomposed(INPUT, { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The arm's assembled IR: max depth across all regions is the per-region
    // depth (2), NOT the sum — decomposition keeps each region independent.
    const armDepth = Math.max(...result.value.regions.map((r) => maxDepth(r.content)));
    expect(armDepth).toBe(2);

    // The SAME three sections composed monolithically (one wrapper region) would
    // add a nesting level → depth 3. The arm is measurably shallower.
    const monolithicDepth = maxDepth([{ block: "core/group", innerBlocks: [section, section, section] }]);
    expect(armDepth).toBeLessThan(monolithicDepth);
  });
});
