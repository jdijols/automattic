// T3-U8 — the experiment arms (origin §3.6). Exactly TWO arms are measured:
//   • C-single      — T3-U4's bounded retry loop (the MVP-default candidate).
//   • C-decomposed  — T3-U7's per-region escalation arm.
//
// Option B is NOT an arm (post-MVP, behind the §3.5 contract-change request), and
// a strict-per-region arm is NOT added (deferred until observed depth is
// consistently ≤5). Both are deliberately excluded — logged, not silently cut.
//
// SECURITY (deepening §security P1): the harness invokes these arms DIRECTLY (not
// via index.ts), and during a LIVE run a provider 401 would surface request
// metadata. Both arms reach the provider through `generateStructured`, whose
// no-object ingestion point already sanitizes the error cause (T3-U5), so no
// `Authorization` header or raw provider metadata reaches a derived metric — and
// the harness records only §5.2 codes + numeric latencies, never a raw cause.
import { type IRValidated, type ValidationResult } from "../../src/validator";
import { generateDecomposed } from "../../src/orchestration/decomposed";
import { type GenerateInput } from "../../src/orchestration/generate";
import { generateWithRetry } from "../../src/orchestration/retry-loop";
import { type LanguageModel } from "ai";

/** An arm: maps a prompt to a validated-or-failed outcome plus the attempt count. */
export type ExperimentArm = (
  input: GenerateInput,
  deps: { model?: LanguageModel },
) => Promise<{ result: ValidationResult<IRValidated>; attempts: number }>;

/** The two measured arms. The experiment compares exactly these. */
export const EXPERIMENT_ARMS: Record<string, ExperimentArm> = {
  "C-single": (input, deps) => generateWithRetry(input, deps),
  "C-decomposed": (input, deps) => generateDecomposed(input, deps),
};

/** Arms deliberately excluded from the experiment (logged scope, not a silent cap). */
export const EXCLUDED_ARMS = ["Option B (post-MVP, §3.5 contract-change)", "strict-per-region (deferred until depth ≤5)"];
