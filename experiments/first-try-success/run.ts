// T3-U8 — the §3.6 first-try-success experiment harness. Runs each arm over the
// corpus (positive archetypes × k paraphrases), measures first-try success
// (% passing the Track-1 validator, layers 1–3) plus the secondary signals
// (latency, diversity, per-region depth), and emits a decision-rule
// RECOMMENDATION judged against the §7.3 latency budget.
//
// It does NOT auto-lock: the lock is the T3-U9 HUMAN decision. And it refuses to
// report a verdict unless the P2 precondition holds (the real validator + the
// positive corpus are present) — it fails with "P2 precondition unmet" rather
// than reporting against a stub.
//
// Provider/error metadata never enters the report: failed runs record only the
// §5.2 error codes + numeric latencies (the §5.2 codes are credential-free), so
// the committed RESULTS.md can never carry an Authorization header.
import { type IRValidated, validateIR } from "../../src/validator";
import { type GenerateInput } from "../../src/orchestration/generate";
import { diversityProxy } from "../../src/orchestration/telemetry";
import { type LanguageModel } from "ai";

import { type CorpusEntry } from "./corpus";
import { type ExperimentArm } from "./arms";

/** The §7.3 latency budget. An arm outside it is excluded from the recommendation. */
export const LATENCY_BUDGET = { p50Ms: 30_000, p95Ms: 90_000 };

/** The seed has 3 patterns; an arm at/under this floor "floors out" on distinctiveness. */
export const DIVERSITY_PATTERN_FLOOR = 3;

/** "Materially worse" = more than this fraction below the other arm. */
const MATERIALLY_WORSE_RATIO = 0.75; // >25% below

/** An arm whose first-try-success rate is below this floor cannot be recommended. */
export const MIN_FIRST_TRY_SUCCESS = 0.5;

// Probes that verify the imported validator is the REAL one (not a stub): a known-
// valid IR must pass and an obviously-invalid one must fail. A no-op/stub validator
// fails one of these, so the harness can refuse to report a verdict against it.
const PROBE_VALID = {
  irVersion: 1,
  theme: { slug: "probe-theme", title: "Probe" },
  tokens: {},
  regions: [{ kind: "template", name: "index", content: [{ block: "core/paragraph", text: "x" }] }],
};
const PROBE_INVALID = { irVersion: 1, theme: { slug: "probe-theme", title: "Probe" }, tokens: {}, regions: [] };

function validatorIsReal(validate: typeof validateIR): boolean {
  return validate(PROBE_VALID).ok === true && validate(PROBE_INVALID).ok === false;
}

export interface ArmMetrics {
  runs: number;
  /** §3.6 first-try success: fraction of runs that PASS the validator (layers 1–3). */
  firstTrySuccessRate: number;
  /** Success-run latency percentiles (failed runs excluded — measured separately). */
  successLatencyP50Ms: number;
  successLatencyP95Ms: number;
  /** Failed-run latencies, kept SEPARATE from the success p50 (origin §3.6). */
  failedRunLatenciesMs: number[];
  diversity: { sampleSize: number; distinctPatterns: number; distinctCompositions: number };
  /** Per-region max-depth distribution (the strict-per-region trigger). */
  regionDepths: number[];
  withinBudget: boolean;
  /** §5.2 codes from failed runs — credential-free; safe for RESULTS.md. */
  failureCodes: string[];
}

export interface ExperimentReport {
  scope: { arms: string[]; excludedArms: string[]; k: number; archetypes: number; layers: string; tuning: string };
  perArm: Record<string, ArmMetrics>;
  recommendation: { decision: string; rationale: string };
}

export type ExperimentOutcome =
  | { status: "report"; report: ExperimentReport }
  | { status: "precondition-unmet"; reason: string };

export interface ExperimentConfig {
  arms: Record<string, ExperimentArm>;
  corpus: CorpusEntry[];
  budget?: { p50Ms: number; p95Ms: number };
  deps?: { model?: LanguageModel; now?: () => number; validate?: typeof validateIR };
  /** Logged tuning mode (real schema vs the pre-#4 stub) — recorded, never silently cut. */
  tuningMode?: string;
}

function maxRegionDepth(ir: IRValidated): number {
  const depthOf = (nodes: readonly unknown[], depth: number): number => {
    let max = 0;
    for (const node of nodes) {
      max = Math.max(max, depth);
      const inner = (node as { innerBlocks?: unknown[] }).innerBlocks;
      if (Array.isArray(inner) && inner.length > 0) max = Math.max(max, depthOf(inner, depth + 1));
    }
    return max;
  };
  return Math.max(0, ...ir.regions.map((region) => depthOf(region.content, 1)));
}

function percentile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[index]!;
}

function flooredOut(metrics: ArmMetrics): boolean {
  return metrics.diversity.distinctPatterns <= DIVERSITY_PATTERN_FLOOR;
}

/**
 * The decision rule (origin §3.6). Never auto-locks — this is a recommendation.
 * PRIMARY metric = first-try success; SECONDARY = diversity (the acceptance's
 * "materially worse on diversity" guard). Layered:
 *   1. latency budget filter → abstain if none.
 *   2. first-try-success floor → abstain if no within-budget arm clears it (an
 *      arm that mostly fails is never recommended just for being fast).
 *   3. materially-better first-try success wins (the primary metric).
 *   4. comparable success → diversity rule: abstain if both floor on the seed,
 *      drop a materially-worse arm, else default to the simpler C-single.
 */
function decide(perArm: Record<string, ArmMetrics>): { decision: string; rationale: string } {
  const inBudget = Object.entries(perArm).filter(([, m]) => m.withinBudget);
  if (inBudget.length === 0) return { decision: "abstain", rationale: "No arm met the §7.3 latency budget." };

  const qualifying = inBudget.filter(([, m]) => m.firstTrySuccessRate >= MIN_FIRST_TRY_SUCCESS);
  if (qualifying.length === 0) {
    return { decision: "abstain", rationale: "No within-budget arm cleared the first-try-success floor." };
  }
  if (qualifying.length === 1) {
    return { decision: qualifying[0]![0], rationale: "Only one within-budget arm cleared the first-try-success floor." };
  }

  // Multiple qualify — PRIMARY: a materially-higher first-try-success rate wins.
  const [a, b] = qualifying;
  const aRate = a![1].firstTrySuccessRate;
  const bRate = b![1].firstTrySuccessRate;
  if (aRate < bRate * MATERIALLY_WORSE_RATIO) {
    return { decision: b![0], rationale: `${a![0]} is materially worse on first-try success.` };
  }
  if (bRate < aRate * MATERIALLY_WORSE_RATIO) {
    return { decision: a![0], rationale: `${b![0]} is materially worse on first-try success.` };
  }

  // Comparable success — SECONDARY: the diversity rule.
  const floored = qualifying.filter(([, m]) => flooredOut(m));
  if (floored.length === qualifying.length) {
    return {
      decision: "abstain",
      rationale: "Both arms floor out on the 3-pattern seed; distinctiveness is punted to Track 2 (pattern library).",
    };
  }
  if (floored.length === 1) {
    const winner = qualifying.find(([name]) => name !== floored[0]![0])!;
    return { decision: winner[0], rationale: `${floored[0]![0]} is materially worse (floors out on diversity).` };
  }
  const aComp = a![1].diversity.distinctCompositions;
  const bComp = b![1].diversity.distinctCompositions;
  if (aComp < bComp * MATERIALLY_WORSE_RATIO) {
    return { decision: b![0], rationale: `${a![0]} is >25% below ${b![0]} on diversity (materially worse).` };
  }
  if (bComp < aComp * MATERIALLY_WORSE_RATIO) {
    return { decision: a![0], rationale: `${b![0]} is >25% below ${a![0]} on diversity (materially worse).` };
  }
  return {
    decision: "C-single",
    rationale: "Diversity is comparable (neither materially worse); default to the simpler C-single (Q7 lean).",
  };
}

/**
 * Run the experiment. Returns a report, or refuses with "precondition-unmet" if
 * the P2 precondition (real validator + positive corpus) is absent.
 */
export async function runExperiment(config: ExperimentConfig): Promise<ExperimentOutcome> {
  if (config.corpus.length === 0) {
    return { status: "precondition-unmet", reason: "P2 precondition unmet: the positive corpus (#6) is absent." };
  }
  const validate = config.deps?.validate ?? validateIR;
  if (!validatorIsReal(validate)) {
    return { status: "precondition-unmet", reason: "P2 precondition unmet: the real validator (#4/#5) is absent or stubbed." };
  }

  const budget = config.budget ?? LATENCY_BUDGET;
  const now = config.deps?.now ?? (() => performance.now());
  const perArm: Record<string, ArmMetrics> = {};

  for (const [name, arm] of Object.entries(config.arms)) {
    const successLatencies: number[] = [];
    const failedRunLatenciesMs: number[] = [];
    const successIRs: IRValidated[] = [];
    const regionDepths: number[] = [];
    const failureCodes: string[] = [];
    let runs = 0;
    let passes = 0;

    for (const entry of config.corpus) {
      for (const prompt of entry.prompts) {
        runs += 1;
        const input: GenerateInput = { userDescription: prompt };
        const start = now();
        const { result } = await arm(input, { model: config.deps?.model });
        const latency = now() - start;
        if (result.ok) {
          passes += 1;
          successLatencies.push(latency);
          successIRs.push(result.value);
          regionDepths.push(maxRegionDepth(result.value));
        } else {
          failedRunLatenciesMs.push(latency);
          for (const error of result.errors) failureCodes.push(error.code); // §5.2 codes only — no cause
        }
      }
    }

    const sorted = [...successLatencies].sort((x, y) => x - y);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    perArm[name] = {
      runs,
      firstTrySuccessRate: runs === 0 ? 0 : passes / runs,
      successLatencyP50Ms: p50,
      successLatencyP95Ms: p95,
      failedRunLatenciesMs,
      diversity: diversityProxy(successIRs),
      regionDepths,
      // An arm with zero successes cannot be "within budget" (no p50 to meet).
      withinBudget: successLatencies.length > 0 && p50 <= budget.p50Ms && p95 <= budget.p95Ms,
      failureCodes,
    };
  }

  const report: ExperimentReport = {
    scope: {
      arms: Object.keys(config.arms),
      excludedArms: ["Option B (post-MVP)", "strict-per-region (deferred)"],
      k: config.corpus[0]?.prompts.length ?? 0,
      archetypes: config.corpus.length,
      layers: "Track-1 validator layers 1–3",
      tuning: config.tuningMode ?? "real-schema",
    },
    perArm,
    recommendation: decide(perArm),
  };
  return { status: "report", report };
}
