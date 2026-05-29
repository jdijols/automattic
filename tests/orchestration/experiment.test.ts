import { beforeEach, describe, expect, it } from "vitest";

import { type IRValidated, type ValidationError } from "../../src/validator";
import { type CorpusEntry, K, POSITIVE_ARCHETYPES, loadCorpus } from "../../experiments/first-try-success/corpus";
import { EXCLUDED_ARMS, EXPERIMENT_ARMS, type ExperimentArm } from "../../experiments/first-try-success/arms";
import { runExperiment } from "../../experiments/first-try-success/run";

// ── helpers: a shared synthetic clock + arm factory (NO live provider calls) ──
const clock = { t: 0 };
const now = (): number => clock.t;

type Outcome = { result: { ok: true; value: IRValidated } | { ok: false; errors: ValidationError[] }; attempts: number };

/** An arm that advances the clock by `latencyMs` per run and returns a canned outcome. */
function makeArm(latencyMs: number, outcome: (prompt: string) => Outcome): ExperimentArm {
  return async (input) => {
    clock.t += latencyMs;
    return outcome(input.userDescription);
  };
}

/** An arm whose per-run latency varies (proves p50≠p95). */
function makeVaryingArm(latencies: number[], outcome: (prompt: string) => Outcome): ExperimentArm {
  let i = 0;
  return async (input) => {
    clock.t += latencies[i % latencies.length]!;
    i += 1;
    return outcome(input.userDescription);
  };
}

beforeEach(() => {
  clock.t = 0; // module-global clock reset so latencies never bleed across tests
});

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

// Two real archetypes × k=2 = a small synthetic corpus (no fixtures needed here).
const corpus: CorpusEntry[] = [
  { archetype: "blog", fixtureInput: {}, prompts: ["p1", "p2"] },
  { archetype: "landing", fixtureInput: {}, prompts: ["p3", "p4"] },
];

const FAST = 10; // ms/run → within budget
const SLOW = 40_000; // ms/run → p50 over the 30s budget

describe("corpus + arm registry (T3-U8)", () => {
  it("loads the real positive corpus: 3 archetypes × k=3 paraphrases (P2 precondition present)", () => {
    const loaded = loadCorpus();
    expect(loaded).toHaveLength(POSITIVE_ARCHETYPES.length);
    expect(loaded.every((e) => e.prompts.length === K)).toBe(true);
    expect(loaded.every((e) => e.fixtureInput !== undefined)).toBe(true);
    expect(K).toBe(3);
  });

  it("registers exactly the two measured arms; Option B and strict-per-region are excluded (logged)", () => {
    expect(Object.keys(EXPERIMENT_ARMS).sort()).toEqual(["C-decomposed", "C-single"]);
    expect(EXCLUDED_ARMS.join(" ")).toMatch(/Option B/);
    expect(EXCLUDED_ARMS.join(" ")).toMatch(/strict-per-region/);
  });
});

describe("runExperiment — §3.6 harness (T3-U8, mocked arms)", () => {
  it("refuses to report a verdict when the corpus is absent (P2 precondition unmet)", async () => {
    const outcome = await runExperiment({ arms: { "C-single": makeArm(FAST, () => success(["a"])) }, corpus: [] });
    expect(outcome.status).toBe("precondition-unmet");
    if (outcome.status === "precondition-unmet") expect(outcome.reason).toMatch(/P2 precondition unmet/);
  });

  it("logs the frozen scope: 2 arms, k, archetypes, layers 1–3, excluded arms — no silent cap", async () => {
    const arms = { "C-single": makeArm(FAST, () => success(["a"])), "C-decomposed": makeArm(FAST, () => success(["a"])) };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    expect(outcome.status).toBe("report");
    if (outcome.status !== "report") return;
    expect(outcome.report.scope.arms).toEqual(["C-single", "C-decomposed"]);
    expect(outcome.report.scope.k).toBe(2);
    expect(outcome.report.scope.archetypes).toBe(2);
    expect(outcome.report.scope.layers).toMatch(/layers 1–3/);
    expect(outcome.report.scope.excludedArms.join(" ")).toMatch(/Option B/);
    expect(outcome.report.scope.excludedArms.join(" ")).toMatch(/strict-per-region/);
  });

  it("abstains when both in-budget arms floor out on the 3-pattern seed", async () => {
    const arms = {
      "C-single": makeArm(FAST, () => success(["hero-cover", "site-footer"])), // ≤3 patterns → floored
      "C-decomposed": makeArm(FAST, () => success(["hero-cover", "query-loop-list"])),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("abstain");
    expect(outcome.report.recommendation.rationale).toMatch(/floor out|Track 2/);
  });

  it("recommends the arm that is not materially worse on diversity (>25% rule)", async () => {
    // Both use >3 patterns (not floored). A: one composition repeated; B: varied.
    const arms = {
      "C-single": makeArm(FAST, () => success(["p1", "p2", "p3", "p4"])), // identical composition every run
      "C-decomposed": makeArm(FAST, (prompt) => success(["p1", "p2", "p3", "p4", prompt])), // varied per prompt
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("C-decomposed");
    expect(outcome.report.recommendation.rationale).toMatch(/materially worse/);
  });

  it("defaults to C-single when diversity is comparable (neither materially worse)", async () => {
    const arms = {
      "C-single": makeArm(FAST, (p) => success(["p1", "p2", "p3", "p4", p])),
      "C-decomposed": makeArm(FAST, (p) => success(["p1", "p2", "p3", "p4", p])),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("C-single");
    expect(outcome.report.recommendation.rationale).toMatch(/comparable/);
  });

  it("abstains when no arm meets the §7.3 latency budget", async () => {
    const arms = {
      "C-single": makeArm(SLOW, (p) => success(["p1", "p2", "p3", "p4", p])),
      "C-decomposed": makeArm(SLOW, (p) => success(["p1", "p2", "p3", "p4", p])),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("abstain");
    expect(outcome.report.recommendation.rationale).toMatch(/latency budget/);
  });

  it("measures failed-run latency separately from the success p50, and records region depths", async () => {
    let n = 0;
    const arms = {
      // alternate success/failure across the 4 runs
      "C-single": makeArm(FAST, () => (n++ % 2 === 0 ? success(["p1", "p2", "p3", "p4"]) : failure(["BLOCK_NOT_ALLOWED"]))),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    const m = outcome.report.perArm["C-single"]!;
    expect(m.firstTrySuccessRate).toBeCloseTo(0.5);
    expect(m.failedRunLatenciesMs.length).toBe(2); // failures tracked separately
    expect(m.regionDepths.length).toBe(2); // one depth per SUCCESSFUL run
    expect(m.successLatencyP50Ms).toBe(FAST);
  });

  it("recommends the single arm that meets the budget when the other is too slow", async () => {
    const arms = {
      "C-single": makeArm(FAST, (p) => success(["p1", "p2", "p3", "p4", p])),
      "C-decomposed": makeArm(SLOW, (p) => success(["p1", "p2", "p3", "p4", p])), // out of budget
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("C-single");
    expect(outcome.report.perArm["C-decomposed"]!.withinBudget).toBe(false);
  });

  it("abstains when a within-budget arm mostly FAILS the validator (below the first-try-success floor)", async () => {
    let n = 0;
    const arms = {
      // 1 success / 4 runs = 0.25 < 0.5 floor, but fast
      "C-single": makeArm(FAST, () => (n++ === 0 ? success(["p1", "p2", "p3", "p4"]) : failure(["BLOCK_NOT_ALLOWED"]))),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    expect(outcome.report.recommendation.decision).toBe("abstain");
    expect(outcome.report.recommendation.rationale).toMatch(/first-try-success floor/);
  });

  it("computes distinct p50 vs p95 from a latency spread", async () => {
    const arms = {
      // four runs: 10,10,10,80000 → p50=10, p95=80000
      "C-single": makeVaryingArm([10, 10, 10, 80_000], () => success(["p1", "p2", "p3", "p4"])),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now }, budget: { p50Ms: 30_000, p95Ms: 90_000 } });
    if (outcome.status !== "report") throw new Error("expected report");
    const m = outcome.report.perArm["C-single"]!;
    expect(m.successLatencyP50Ms).toBe(10);
    expect(m.successLatencyP95Ms).toBe(80_000); // genuinely different from p50
  });

  it("refuses a verdict when the validator is a stub (real-validator precondition)", async () => {
    const stubValidate = (() => ({ ok: true, value: {} as IRValidated })) as never;
    const outcome = await runExperiment({
      arms: { "C-single": makeArm(FAST, () => success(["a"])) },
      corpus,
      deps: { now, validate: stubValidate },
    });
    expect(outcome.status).toBe("precondition-unmet");
    if (outcome.status === "precondition-unmet") expect(outcome.reason).toMatch(/real validator.*absent or stubbed/);
  });

  it("never writes Authorization / provider metadata to the report (only §5.2 codes)", async () => {
    const arms = {
      // a failing arm whose error message embeds a credential — only the CODE is recorded
      "C-single": makeArm(FAST, () => failure(["MALFORMED_INPUT"], "401 Authorization: Bearer sk-leak-xyz")),
    };
    const outcome = await runExperiment({ arms, corpus, deps: { now } });
    if (outcome.status !== "report") throw new Error("expected report");
    const serialized = JSON.stringify(outcome.report);
    expect(serialized).not.toContain("sk-leak-xyz");
    expect(serialized).not.toContain("Authorization");
    expect(outcome.report.perArm["C-single"]!.failureCodes).toContain("MALFORMED_INPUT"); // code IS kept
  });
});
