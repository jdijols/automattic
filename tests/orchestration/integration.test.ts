import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { validateIR } from "../../src/validator";
import { type GenerationArm, generateTheme } from "../../src/orchestration/index";
import { RETRY_BUDGET } from "../../src/orchestration/retry-loop";
import { type ProgressSignal } from "../../src/orchestration/contract";

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

const HALLUCINATED = {
  irVersion: 1,
  theme: { slug: "x-theme", title: "X" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/made-up" }] }],
};
const INPUT = { userDescription: "A clean blog." };

describe("generateTheme — public entry point (T3-U6)", () => {
  it("returns a done result with the validated IR on success", async () => {
    const result = await generateTheme(INPUT, { model: sequenceModel([JSON.stringify(blogInput())]) });
    expect(result.status).toBe("done");
    if (result.status === "done") expect(result.ir.regions.length).toBeGreaterThan(0);
  });

  it("returns a failed result whose §5.2 list is passed through byte-unmodified", async () => {
    const result = await generateTheme(INPUT, { model: sequenceModel([JSON.stringify(HALLUCINATED)]) });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      // The exact validator output, not re-wrapped or re-interpreted.
      const direct = validateIR(HALLUCINATED);
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(result.errors).toEqual(direct.errors);
    }
  });

  it("exposes nothing beyond {status, ir} | {status, errors} — no prompt/provider/tier", async () => {
    const done = await generateTheme(INPUT, { model: sequenceModel([JSON.stringify(blogInput())]) });
    expect(Object.keys(done).sort()).toEqual(["ir", "status"]);
    const failed = await generateTheme(INPUT, { model: sequenceModel([JSON.stringify(HALLUCINATED)]) });
    expect(Object.keys(failed).sort()).toEqual(["errors", "status"]);
    // Each surfaced error carries ONLY the published §5.2 fields — no leaked
    // prompt/provider/tier/raw-internal field can ride along on an error object.
    if (failed.status === "failed") {
      const allowed = new Set(["code", "layer", "path", "message", "invariant", "hint"]);
      for (const error of failed.errors) {
        for (const key of Object.keys(error)) expect(allowed.has(key), `unexpected error field: ${key}`).toBe(true);
      }
    }
  });

  describe("progress stream", () => {
    it("emits generating → retrying(2/3) → done on fail→pass", async () => {
      const signals: ProgressSignal[] = [];
      await generateTheme(INPUT, {
        model: sequenceModel([JSON.stringify(HALLUCINATED), JSON.stringify(blogInput())]),
        onProgress: (s) => signals.push(s),
      });
      expect(signals).toEqual([
        { phase: "generating", attempt: 1, of: RETRY_BUDGET },
        { phase: "retrying", attempt: 2, of: RETRY_BUDGET },
        { phase: "done" },
      ]);
    });

    it("emits a retrying(n/3) for each retry and terminates in failed, bounded to ≤ budget+1", async () => {
      const signals: ProgressSignal[] = [];
      await generateTheme(INPUT, {
        model: sequenceModel([JSON.stringify(HALLUCINATED)]),
        onProgress: (s) => signals.push(s),
      });
      expect(signals.at(-1)).toEqual({ phase: "failed" });
      expect(signals.filter((s) => s.phase === "retrying").map((s) => s.attempt)).toEqual([2, 3]);
      // C-single bound: budget attempts + 1 terminal. (The "+ N_max_regions" term
      // of the documented bound applies to the C-decomposed per-region arm, T3-U7.)
      expect(signals.length).toBeLessThanOrEqual(RETRY_BUDGET + 1);
    });

    it("fires the telemetry sink AND progress together through the public entry point", async () => {
      const events: { kind: string }[] = [];
      const signals: ProgressSignal[] = [];
      await generateTheme(INPUT, {
        model: sequenceModel([JSON.stringify(blogInput())]),
        sink: { emit: (e) => events.push(e) },
        onProgress: (s) => signals.push(s),
      });
      // Both seams are wired end-to-end at the boundary, not just one layer down.
      expect(events.some((e) => e.kind === "first-try-success")).toBe(true);
      expect(events.some((e) => e.kind === "latency")).toBe(true);
      expect(signals.some((s) => s.phase === "done")).toBe(true);
    });
  });

  it("routes through an injected arm — the C-decomposed escalate branch is buildable", async () => {
    let armCalled = false;
    // A stand-in for the T3-U7 C-decomposed arm: the config point must select it
    // instead of C-single, with no real generation happening.
    const sentinelErrors = [
      { code: "SCHEMA_VALIDATION" as const, layer: "schema" as const, path: "ARM_SENTINEL", message: "from stub arm", invariant: null },
    ];
    const stubArm: GenerationArm = async () => {
      armCalled = true;
      return { result: { ok: false, errors: sentinelErrors }, attempts: 1 };
    };
    const result = await generateTheme(INPUT, { arm: stubArm });
    expect(armCalled).toBe(true); // the config point selected the injected arm
    expect(result.status).toBe("failed");
    // Reference identity proves the §5.2 list is passed through byte-unmodified —
    // index.ts neither clones nor transforms the arm's error array.
    if (result.status === "failed") expect(result.errors).toBe(sentinelErrors);
  });
});
