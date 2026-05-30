// T4-U1 — the LIVE §3.6 first-try-success runner. This is the real-provider entry
// point the harness was missing: run.ts had runExperiment() but nothing wired it to
// a real model and a written report.
//
// It is a vitest test (reusing the existing dep — NO tsx, no new dependency) that:
//   • SELF-SKIPS when ANTHROPIC_API_KEY is absent, so it spends nothing by accident
//     and never reds a keyless CI/`npm run experiment`.
//   • when the key IS set, builds the real model via defaultModel(), loads the
//     positive corpus + the two measured arms, runs the experiment against the
//     §7.3 latency budget, writes RESULTS.md via the (mock-tested) report writer,
//     and asserts the harness produced a report (not a precondition-unmet refusal).
//
// It lives OUTSIDE the fast (tests/**, src/**) and slow (tests/harness/**,
// tests/e2e/**) include globs, so only `npm run experiment`
// (vitest.experiment.config.ts) collects it. RESULTS.md is the human's to commit
// after a supervised, token-spending run — it is git-ignored, not committed here.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defaultModel } from "../../src/orchestration/provider";
import { EXPERIMENT_ARMS } from "./arms";
import { loadCorpus } from "./corpus";
import { runExperiment } from "./run";
import { formatExperimentReport } from "./report";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const RESULTS_PATH = fileURLToPath(new URL("./RESULTS.md", import.meta.url));

describe("§3.6 first-try-success — LIVE runner (real provider, supervised token spend)", () => {
  it.skipIf(!HAS_KEY)(
    "runs both arms over the corpus and writes RESULTS.md",
    async () => {
      const outcome = await runExperiment({
        arms: EXPERIMENT_ARMS,
        corpus: loadCorpus(),
        deps: { model: defaultModel() },
      });

      // The harness must produce a verdict, not refuse on a precondition (the real
      // validator + positive corpus are present here, so a refusal is a real bug).
      if (outcome.status !== "report") {
        throw new Error(`experiment refused to report: ${outcome.reason}`);
      }

      writeFileSync(RESULTS_PATH, formatExperimentReport(outcome.report), "utf8");
      expect(outcome.status).toBe("report");
    },
    600_000,
  );
});
