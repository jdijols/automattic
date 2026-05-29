# Handoff — 2026-05-29: Track-1 backbone + Track-3 orchestration complete

**Status.** `main` @ `4026ea0` (GitHub) — **synced to GitLab @ `4026ea0`** (the graded/submission repo). Full suite green; CI green (fast gate + the slow Playground gate from U11). The new chat will have the full Phase-B loop transcript pasted in — this doc is *continuity*, not a re-derivation. Resume with `/context-restore`.

## Where we are

- **Track-1 correctness backbone (U1–U11): ✅ COMPLETE.** IR Zod schema (`src/ir/`) → layered fail-closed validator `validateIR` (`src/validator/`) → theme.json compile + AJV → adversarial corpus → frozen contract (`contract/`) → block serializer + structured pattern substitution (`src/assembler/serializer.ts`, `patterns.ts`) → deterministic byte-reproducible assembler + zip + layer-4 `wp:html` scan (`src/assembler/`) → WordPress Playground install/activate gate (`src/harness/`) → e2e + CI fast/slow split. Issues **#1–#11 closed**.
- **Track-3 AI orchestration (T3-U1–U10, #15–#24 except #23): ✅ COMPLETE.** provider seam (`src/orchestration/provider.ts`) → cacheable prompt + producer guards → C-single generate → bounded retry loop → telemetry → downstream contract + `generateTheme` entry (`src/orchestration/index.ts`) → C-decomposed arm → §3.6 experiment harness (`experiments/first-try-success/`) → opsec server seam (`src/orchestration/limits.ts`, `app/api/generate/route.ts`).
- **Docs:** plans `docs/plans/2026-05-28-001-*` (Track 1) and `…-002-*` (Track 3); `docs/phase-1-prd.md`, `docs/phase-2-prd.md`; `docs/adr/0001-application-stack.md`.

## Open / deferred — the work left to a submittable product

1. **#23 (T3-U9, Q7) — the only open issue. HITL.** Run the §3.6 experiment harness (`experiments/first-try-success/run.ts`) against the REAL provider (needs `ANTHROPIC_API_KEY` + tokens), read the recommendation, lock C-single vs C-decomposed by flipping the single arm-selection config point in `src/orchestration/index.ts`. Default today = C-single (the guaranteed-correct floor).
2. **App NOT wired end-to-end (the headline MVP flow). VERIFIED GAP.** `app/api/generate/route.ts` calls `generateTheme(input)` and returns the **IR as JSON** (`Response.json(result.body)`) — it does NOT call the assembler or return a downloadable `.zip`. The pieces all exist (orchestration → validated IR; assembler → zip; install gate verifies) but are NOT connected at the HTTP boundary. **Wiring `route → assemble → return .zip` is the top functional next step.**
3. **Track 4 (UI) — not planned/built.** NL + structured-criteria input form, §5.2 error rendering, download UX. Server seam exists; front-end doesn't. Needs plan + build (loop recipe).
4. **Required graded docs — NOT done:** README (local-run, env, architecture, known limitations), a consolidated ADR (model/output/alternatives/tradeoffs/security/design-exploration — source is in the PRDs + ADR-0001 + contract), and "What I'd Do Next". The brief grades all three. (These were the planned parallel work during Phase B that we did not get to.)
5. **Product name** — still the "Automattic" placeholder; pick before any Vercel deploy. Candidates in `CLAUDE.md` (Blocksmith etc.).
6. **3 plan-accuracy nits** in `docs/plans/…-002-*`: `validateIR`/`.value` naming, gradient-scope-edge note, dangling-token re-prompt copy. Non-blocking (the contract is authoritative + correct).

## Suggested next-step order

1. Re-confirm GitLab @ `main` (FF) — it's the submission repo. (Synced to `4026ea0` at this handoff.)
2. **#23 (Q7):** run the experiment, lock the arm. (Your call + API key.)
3. **Wire `route → assemble → download`** — connect U9's assembler to the HTTP response (the MVP headline path).
4. **Plan + build Track 4 (UI)** via the loop recipe.
5. **Write README + ADR + "What I'd Do Next".**
6. **Pick product name → configure Vercel deploy → deploy.**
7. **Final GitLab sync → submit the GitLab link.**

## Carryover gotchas / conventions (CRITICAL — learned this session)

1. **npm-10 lockfile gotcha (recurring — bit T3-U1 AND U8).** CI = Node 20/npm 10; local = Node 25/npm 11. npm 11 drops a nested `yaml` entry npm-10's `npm ci` requires → red CI at install. **Any dependency change must regenerate `package-lock.json` with `npx -y npm@10 install`, NOT npm 11.** Tell every loop/agent this.
2. **GitHub = build engine; GitLab = graded/submission repo, MIRROR-ONLY.** Never commit directly to GitLab. Sync via `git push gitlab origin/main:refs/heads/main` (fast-forward). GitLab "Allowed to force push" is OFF — keep it off (FF works; the one-time divergence is fixed). **Sync GitLab after every batch of merges and before submission.**
3. **Parallelization model (proven across Phase A, Track 3, Phase B).** Loops run in a terminal (`claude --dangerously-skip-permissions` → `/loop …`) on the main repo, one dependency-ordered AFK unit per iteration (tdd → ce-work → verify → code-review → ship → PR → self-merge on green CI); HITL units excluded. Isolated work → worktrees in `/tmp` (NOT Code-Projects siblings — a sibling worktree caused confusion once); clean up after. Injection-surface units get an INDEPENDENT security review before merge (U7 vouch, U8 review).
4. **Frozen contract (`contract/`) + the real `validateIR` are authoritative over the plans** (plans carry minor naming nits). Code against `contract/error-format.md` + `validateIR(): ValidationResult<IRValidated>` keyed on `.value`.
5. **Use "Closes #N" in PR bodies** so issues auto-close (U8's PR didn't → #8 closed by hand).
6. **Disqualifying constraint holds:** zero Custom HTML block (`wp:html`) — enforced at the IR allowlist enum + validator + layer-4 byte scan. Never weaken.
7. **The autonomous-loop + parallel-tracks recipe is proven** → candidate to skillify (`write-a-skill` / `superpowers:writing-skills`) per CLAUDE.md once stable.

## Suggested skills on resume

`/context-restore` · `/ce-plan` + `/to-issues` + `/loop` (Track 4) · `/ce-brainstorm` (Track 4 scope) · `/ship`, `/land-and-deploy`, `/setup-deploy` (Vercel).
