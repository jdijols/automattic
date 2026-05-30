// T4-U1 — the §3.6 experiment REPORT WRITER, verified mock-driven (no token spend).
//
// The report writer (experiments/first-try-success/report.ts) turns an
// ExperimentReport into human-readable markdown for the committed RESULTS.md. This
// test drives the REAL runExperiment with stub arms (the experiment.test.ts mock
// pattern — no live provider, no ANTHROPIC_API_KEY) to produce a genuine report,
// then asserts the formatted markdown carries every section the human reviewer of
// issue #23 needs: per-arm first-try-success, latency p50/p95, diversity, and the
// recommendation. It lives UNDER tests/ so the FAST gate collects it (the experiment
// dir is outside vitest.config.ts's include globs).
import { beforeEach, describe, expect, it } from "vitest";

import { type IRValidated, type ValidationError } from "../../src/validator";
import { type CorpusEntry } from "../../experiments/first-try-success/corpus";
import { type ExperimentArm } from "../../experiments/first-try-success/arms";
import { type ExperimentReport, runExperiment } from "../../experiments/first-try-success/run";
import { formatExperimentReport } from "../../experiments/first-try-success/report";

// ── a synthetic clock + stub-arm factory, mirroring experiment.test.ts ──
const clock = { t: 0 };
const now = (): number => clock.t;
beforeEach(() => {
  clock.t = 0;
});

type Outcome = { result: { ok: true; value: IRValidated } | { ok: false; errors: ValidationError[] }; attempts: number };

function makeArm(latencyMs: number, outcome: (prompt: string) => Outcome): ExperimentArm {
  return async (input) => {
    clock.t += latencyMs;
    return outcome(input.userDescription);
  };
}

const ir = (patterns: string[]): IRValidated =>
  ({
    irVersion: 1,
    theme: { slug: "t", title: "T", wpVersionTarget: "6.6" },
    tokens: {},
    regions: [{ kind: "template", name: "index", content: patterns.map((p) => ({ pattern: p })) }],
  }) as unknown as IRValidated;

const success = (patterns: string[]): Outcome => ({ result: { ok: true, value: ir(patterns) }, attempts: 1 });
const failure = (codes: ValidationError["code"][], message = "m"): Outcome => ({
  result: { ok: false, errors: codes.map((code) => ({ code, layer: "schema", path: "", message, invariant: null })) },
  attempts: 3,
});

const corpus: CorpusEntry[] = [
  { archetype: "blog", fixtureInput: {}, prompts: ["p1", "p2"] },
  { archetype: "landing", fixtureInput: {}, prompts: ["p3", "p4"] },
];

const FAST = 10;

async function reportFrom(arms: Record<string, ExperimentArm>, budget?: { p50Ms: number; p95Ms: number }): Promise<ExperimentReport> {
  const outcome = await runExperiment({ arms, corpus, deps: { now }, budget });
  if (outcome.status !== "report") throw new Error("expected a report");
  return outcome.report;
}

describe("formatExperimentReport — §3.6 report writer (T4-U1, mock-driven)", () => {
  it("renders every required section heading", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])),
      "C-decomposed": makeArm(FAST, (p) => success(["p1", "p2", "p3", "p4", p])),
    };
    const md = formatExperimentReport(await reportFrom(arms));

    expect(md).toMatch(/First-Try-Success Experiment/);
    expect(md).toMatch(/## Scope/);
    expect(md).toMatch(/## Per-arm metrics/);
    expect(md).toMatch(/## Recommendation/);
  });

  it("renders per-arm first-try-success rate, latency p50/p95, and diversity", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])), // 100% pass, 4 distinct patterns, 1 composition
    };
    const md = formatExperimentReport(await reportFrom(arms));

    expect(md).toContain("C-single");
    expect(md).toMatch(/100(\.0)?%/); // first-try-success rate as a percentage
    expect(md).toContain("10 ms"); // p50 and p95 latency (all runs 10ms)
    expect(md).toMatch(/distinct patterns/i);
    expect(md).toContain("4"); // 4 distinct patterns
  });

  it("renders the recommendation decision and rationale verbatim", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])), // identical composition → lower diversity
      "C-decomposed": makeArm(FAST, (p) => success(["p1", "p2", "p3", "p4", p])), // varied → higher diversity
    };
    const report = await reportFrom(arms);
    const md = formatExperimentReport(report);

    expect(report.recommendation.decision).toBe("C-decomposed");
    expect(md).toContain(report.recommendation.decision);
    expect(md).toContain(report.recommendation.rationale);
  });

  it("renders the scope: arms measured, excluded arms, k, archetypes, and judging layers", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])),
      "C-decomposed": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])),
    };
    const md = formatExperimentReport(await reportFrom(arms));

    expect(md).toContain("C-single");
    expect(md).toContain("C-decomposed");
    expect(md).toMatch(/Option B/); // excluded arms logged, not silently cut
    expect(md).toMatch(/strict-per-region/);
    expect(md).toMatch(/layers 1–3/);
  });

  it("never leaks a credential embedded in a failure message — only §5.2 codes reach the markdown", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => failure(["MALFORMED_INPUT"], "401 Authorization: Bearer sk-leak-xyz")),
    };
    const md = formatExperimentReport(await reportFrom(arms));

    expect(md).not.toContain("sk-leak-xyz");
    expect(md).not.toContain("Authorization");
    expect(md).toContain("MALFORMED_INPUT"); // the code itself is safe to surface
  });
});
