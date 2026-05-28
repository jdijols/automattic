---
session: session-2 (afternoon)
date: 2026-05-28
branch: main
status: phase-1-planned-reviewed-issued · repo-live · build-ready
---

# Handoff — Phase 1 planned, reviewed, and issued

Durable narrative for resuming in a fresh chat. Pairs with the `/context-save` checkpoint (machine-local auto-resume). References artifacts by path — it does **not** duplicate them. Read the linked files for detail.

## Where we are

Phase 1 (the **Track 1 correctness backbone**) is fully planned, independently review-hardened, and broken into **11 grabbable GitHub issues**. The project now has a live GitHub repo (public) mirrored to the Gauntlet GitLab. **No application code yet** — the next action is to build U1. This session took Phase 1 from "PRD ready for `/ce-plan`" → "issues ready to build."

## Key decisions (links, not restatements)

- **3 deferred Phase-1 PRD questions resolved** (commit `80749b5`): time-box Track 1 to the must-have bar + redirect remaining budget to Track 2 pattern breadth; keep the allowlist pattern-gated; qualified freeze (envelope frozen, recursive-tree encoding provisional per Q7). → [`docs/phase-1-prd.md` § Deferred / Open Questions](../phase-1-prd.md)
- **Phase 1 implementation plan** (commit `0883d16`): 11 units, 2 phases (A: foundation + frozen contract; B: assembler + install gate). → [`docs/plans/2026-05-28-001-feat-track1-correctness-backbone-plan.md`](../plans/2026-05-28-001-feat-track1-correctness-backbone-plan.md)
- **The plan was deepened (architecture + security) and run through a 5-persona `/ce-doc-review`** (`deepened: 2026-05-28`). Real defects caught and fixed in-plan: a React-19 `npm install` break, a footer-pattern nav-provisioning gap, an unfreezeable `patternRef.params` contract, an orphaned XSS vector on the `patternRef` path, and a `oneOf` mis-discrimination bug. See the plan's Risks table for the full record.
- **Stack / architecture** unchanged from the PRDs: → [`docs/adr/0001-application-stack.md`](../adr/0001-application-stack.md), [`docs/phase-1-prd.md`](../phase-1-prd.md), [`docs/phase-2-prd.md`](../phase-2-prd.md) (Q7 → Option C), [`STRATEGY.md`](../../STRATEGY.md).
- **Repo + remotes (new this session):** GitHub (`origin`, **public**) https://github.com/jdijols/automattic; GitLab (`gitlab`) https://labs.gauntletai.com/jasondijols/automattic. Both carry `main`.
- **11 issues `#1`–`#11` = U1–U11**, dependency-wired via "Blocked by", `agent-ready` label on the 9 AFK slices; `#7` (frozen contract) and `#8` (serializer / slot convention) are **HITL** (deliberately unlabeled).

## Still open / deferred

- **Two HITL gates inside the build:** `#7` U7 — a human signs off before the contract is frozen and Track 3 starts; `#8` U8 — the Track 1↔Track 2 slot-declaration convention is a design call and the seed pattern `meta.json` need back-filling. Plus a natural human gate at the Phase A→B boundary.
- **Deferred cross-track (named, not built):** rate-limiting / provider-spend guard → Track 3 (Phase 2 PRD **Q16**); download-endpoint access control → Track 4. Both documented in the plan's Operational Notes.
- **Product name** is still a TODO. The repo is named `automattic` to match the GitLab submission path, but the *deployed product name* and the npm `package.json` name must not be "Automattic" (see [`CLAUDE.md` § Naming](../../CLAUDE.md)).
- **Genuinely cross-track open questions** from the PRDs: **Q7** (the §3.6 first-try-success experiment for the recursive tree under hosted strict mode) and **Q9** (WP-version coverage — single 6.6 target for the MVP).

## Next — exact next steps

1. **Start U1** ([issue #1](https://github.com/jdijols/automattic/issues/1), AFK, no blockers): the scaffold — npm init, TS strict, Next 15 / React 19, exact-pinned `@wordpress/blocks` + `@wordpress/block-library`, Vitest, CI fast-job skeleton, `.env.example`. Build via the gated loop: `/tdd → /ce-work → verify → /code-review → /ship`.
2. After U1 lands, `#2` U2 unblocks; then `#3`/`#5` fan out. Follow the dependency graph in the plan (and the "Blocked by" on each issue).
3. At `#7` and `#8`: **stop for human input** (HITL) before proceeding.

## Gotchas / notes for the next session

- **Dependency pins are load-bearing — do not let them drift.** `@wordpress/blocks` peer-requires **React 19**, so pin React 19 + Next 15/16 or a fresh `npm install` ERESOLVE-fails (breaks the brief's zero-friction bar). Pin `@wordpress/blocks` to an **exact** version: its `save()` defines both the U8 serializer parity oracle AND U9 byte-reproducibility, so a caret bump silently breaks the golden file.
- **`block.json` source = `@wordpress/block-library`** — `@wordpress/blocks` ships none.
- **U8 seed-blob reality:** the 3 seed `pattern.html` carry no positional slot markers and their `meta.json` `parameterizable` fields are prose. U8's first task is defining the slot→attribute convention + back-filling the seed `meta.json` — otherwise the substitution happy-path test cannot pass.
- **gbrain — Night-1 gotcha RESOLVED (2026-05-28).** Root cause was two-fold: (1) `VOYAGE_API_KEY` lived only in `~/.zshrc` (interactive shells), but gbrain runs as a non-interactive subprocess that sources `~/.zshenv` — so the key never reached it; (2) gbrain `v0.18.2` couldn't target Voyage at all (no embedding-model config; it defaulted to OpenAI). Fixed by: moving the key to **`~/.zshenv`**; upgrading gbrain **0.18.2 → 0.41.26.1** (`git checkout origin/HEAD` in `~/.bun/install/global/node_modules/gbrain` + `bun install`); wiping + re-initing the brain on **voyage-code-3 (1024-dim)** (`gbrain init --pglite --embedding-model voyage:voyage-code-3`); re-importing via `/sync-gbrain --full`. **Vector queries return real cosine scores — embeddings work, and the full backfill is complete: 4050/4050 chunks embedded, 0 errors**, after adding $20 of Voyage credits (Usage tier 1) lifted the free-tier rate limit that initially throttled it. Claude Code was restarted, so the `mcp__gbrain__*` (0.41) tools are live and the new process inherits the `~/.zshenv` key. Notes: old 0.18 brain preserved at `~/.gbrain/brain.pglite.bak-*` (deletable once confident); a few stale `gbrain serve` orphans from prior sessions may linger (harmless; clear on next full restart); repo-trust policy still unset (`origin` now exists).
- **Intentionally-unstaged working-tree items** (left alone across sessions): `References/Bookmarks.md` (a user edit) and the `Logs/.gitkeep` deletion.

## Suggested skills for next session

- `/context-restore` — or invoke any gstack skill; the preamble auto-surfaces the latest checkpoint.
- `/ce-work docs/plans/2026-05-28-001-feat-track1-correctness-backbone-plan.md` — or grab [issue #1](https://github.com/jdijols/automattic/issues/1) — to start the build.
- `/tdd` per ticket (the plan's per-unit test scenarios are the red bar).

## Commit trail (this session)

`80749b5` resolve Phase-1 deferred questions → `0883d16` add Track 1 implementation plan → GitHub repo created + pushed (`origin` + `gitlab`) → 11 issues filed (`#1`–`#11`) → this handoff.
