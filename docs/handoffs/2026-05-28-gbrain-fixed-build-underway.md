---
session: session-3 (afternoon, post-restart)
date: 2026-05-28
branch: main (work now spans main + feat/u2 + a plan/phase-2-track3 worktree)
status: phase-1-build-underway · U1-merged · gbrain-fixed
---

# Handoff — gbrain fixed; Phase 1 build underway (U1 merged)

Durable narrative for resuming in a fresh chat. Pairs with the `/context-save` checkpoint (machine-local). References artifacts by path; does not duplicate them. Supersedes [`2026-05-28-phase-1-planned-and-issued.md`](2026-05-28-phase-1-planned-and-issued.md) as the current pointer.

## Where we are

The Phase 1 build has **started**. **U1 (project scaffold) is built and merged to `main`** (PR #12, issue #1 CLOSED). U2–U11 remain open issues. This chat's main effort was a side-quest: **fixing gbrain embeddings end-to-end** (now fully working). A parallel **Phase 2 / Track 3 plan worktree** also exists. Good stopping point.

## This session's work

- **gbrain embeddings fixed (the session's main effort).** Root cause was two-fold: `VOYAGE_API_KEY` lived only in `~/.zshrc` (interactive shells) but gbrain runs as a non-interactive subprocess that reads `~/.zshenv`; and gbrain `v0.18.2` couldn't target Voyage at all. Fix: key → `~/.zshenv`; gbrain upgraded **0.18.2 → 0.41.26.1**; brain wiped + re-init on **voyage-code-3 (1024-dim)**; re-imported. After adding **$20 of Voyage credits** (Usage tier 1) to clear the free-tier rate limit, the backfill completed: **4050/4050 chunks embedded, 0 errors.** Semantic `gbrain query` returns real vector hits. Full detail in [`2026-05-28-phase-1-planned-and-issued.md`](2026-05-28-phase-1-planned-and-issued.md) (gbrain note) and [`CLAUDE.md` § GBrain Configuration](../../CLAUDE.md).
- **Discovered the build advanced during the restart:** an agent built U1 → PR #12 → merged to `main`.
- **Corrected a misplaced commit:** post-restart the repo was on `feat/u2`, so a handoff-doc commit landed there instead of `main`; fast-forwarded `main` to include it (no loss) and pushed.

## Workspace state (multi-branch now — read before resuming)

- **Remotes:** `origin` = github.com/jdijols/automattic (public), `gitlab` = labs.gauntletai.com/jasondijols/automattic. Both `main` at `57bc18d`.
- **Branches:** `main` (U1 scaffold + all continuity docs); `feat/u1-scaffold` (merged via #12 — safe to delete); `feat/u2-allowlist-grammar-attrs` (currently `= main`, **U2 not started on it yet**).
- **Worktrees:** the main dir (`Automattic`) is checked out on `feat/u2`; a second worktree `Automattic-phase2-plan` is on `plan/phase-2-track3` (`b536eea`) — **parallel Phase 2 / Track 3 work, not authored or reviewed in this chat**; treat its contents as someone else's in-flight work.
- **Issues:** #1 CLOSED (U1). **#2–#11 OPEN.** #7 (U7 frozen contract) and #8 (U8 serializer/slot-convention) are **HITL**; the rest are `agent-ready` (AFK).

## Next — exact next steps

1. **Build U2** ([issue #2](https://github.com/jdijols/automattic/issues/2), agent-ready): block allowlist + containment grammar + attribute overlay, on `feat/u2`. Loop: `/tdd → /ce-work → verify → /code-review → /ship` → PR to `main` (like U1/#12).
2. Then **U3 / U5** fan out (per the plan's dependency graph). U4 needs U2+U3; U6 needs U4+U5.
3. **Stop for human input at #7 and #8** (HITL).
4. The `plan/phase-2-track3` worktree's Phase 2 / Track 3 work can proceed in parallel; Track 3 formally unblocks once U7 publishes the frozen contract.

## Gotchas / notes

- **gbrain works now (Voyage).** Future *bulk* re-embeds can hit Voyage rate limits — the paid tier (Usage tier 1) handles it; the free tier throttles hard (`Too Many Requests`). After any gbrain upgrade, **restart Claude Code** so the `mcp__gbrain__*` tools reload. The key must stay in **`~/.zshenv`** (not `.zshrc`) so non-interactive subprocesses see it. Old brains backed up at `~/.gbrain/brain.pglite.bak-*` (deletable once confident). A few stale `gbrain serve` orphans from prior sessions may linger (harmless; clear on a full restart).
- **Commit routing:** continuity docs (handoffs, CLAUDE.md notes) go straight to `main`; feature work (U2+) goes via `feat/*` branches + PRs (the U1/#12 pattern).
- **Intentionally-unstaged working-tree items** (left alone across sessions): `References/Bookmarks.md`, the `Logs/.gitkeep` deletion.
- Product name still a TODO (repo named `automattic` to match the GitLab submission; the deploy + `package.json` name must not be "Automattic").

## Commit trail (this session, on `main`)

`80749b5` PRD deferred-question resolutions → `0883d16` Track 1 plan → `a66c841` phase-1 handoff → `5d467a0`/`349de37`/`dca3928` gbrain doc corrections → `b536eea` U1 scaffold merge (#12) → `57bc18d` gbrain backfill complete → this handoff.
