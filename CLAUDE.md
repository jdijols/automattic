# CLAUDE.md — Gauntlet AI Partner Project (Automattic track)

This file is the canonical project context for any AI coding agent (Claude Code, OpenClaw, Codex, Cursor) operating in this repo. Read it before doing anything else.

> **About the name.** The product is named **Automattic** — a deliberate homage to [**Automattic**](https://automattic.com), the parent company of WordPress.com, Tumblr, WooCommerce, Pocket Casts, Day One, Simplenote, and most of the modern WordPress ecosystem, and the Partner reviewing this Gauntlet AI Challenger submission. This is a portfolio piece authored by Jason Dijols — **not** an Automattic product nor an official Automattic project; the name is a tribute, adopted as a conscious accepted tradeoff. See [Naming](#naming).

## What this project is

A **Gauntlet AI Partner Project — Challenger submission** evaluated by Automattic: an AI-powered **WordPress Block Theme Generator**.

The user provides a natural-language site description (e.g. *"A dark-mode blog theme for photographers with a large, centered hero section and sticky navigation"*) plus structured criteria (color palette, typography). The application generates a complete, valid WordPress Full Site Editor (FSE) Block Theme and packages it as an installable zip.

Full brief: [References/Automattic_Project-Brief.pdf](References/Automattic_Project-Brief.pdf)
Curated reference links: [References/Bookmarks.md](References/Bookmarks.md)

## Hard constraint (disqualifying if violated)

**The generated theme MUST NOT use the Custom HTML block (`<!-- wp:html -->`) for any structural or visual element.** All generated content must use native WordPress block syntax (`<!-- wp:paragraph -->`, `<!-- wp:post-featured-image -->`, `<!-- wp:cover -->`, `<!-- wp:query -->`, etc.).

This is the single most-emphasized constraint in the brief. The output validator must detect and reject any `wp:html` usage in generated content. The ADR must explicitly document how the system enforces this.

## Core requirements

1. **User Input Interface** — natural language + structured criteria collection
2. **AI Orchestration** — prompt construction layer that constrains the model to valid block syntax
3. **Structured Output** — valid `theme.json`, template files, pattern files, parts
4. **No Custom HTML Block** — enforced at output-validation time
5. **Deliverable Theme Package** — zipped, installable, activates cleanly in vanilla WordPress

## Technical constraints

- **Standalone** — no external services required to run the app beyond the chosen AI provider
- **Language-agnostic stack** — output is WordPress-specific (JSON/PHP/HTML); app stack is open
- **AI provider** — OpenAI, Anthropic, or local model — chosen provider; integration must be swappable
- **Quality bar** — production-minded MVP, not a prototype

## Required deliverables

1. **Working application** — input criteria → generate theme → download zip, minimal-setup local run
2. **README** — local-run instructions, env vars, architecture overview, known limitations
3. **ADR (Architectural Decision Record)** — model choice, output format choice, alternatives rejected, tradeoffs accepted, security considerations (user-string handling), design exploration
4. **"What I'd Do Next"** — priorities for another week, production-readiness gaps (e.g. formal block validation pipeline), scaling discussion
5. **Code** — clean, typed, tested, linted; incremental well-scoped commits; small focused PRs

## Quality bar

- **Error handling**: graceful API failure + rate-limit handling; robust validation of AI output (invalid JSON / malformed block markup → meaningful error, never silent failure); input validation where it matters (theme slug)
- **Testing**: unit tests on core logic (prompt construction, output validation, file packaging); at least one integration test covering the end-to-end flow; `npm test` (or equivalent) passes cleanly with no setup friction
- **Git hygiene**: incremental commits with clear subject lines; small focused PRs even when solo; commit history that tells the story of how this was built

## Suggested phases (from brief)

| Phase | Hours | Focus |
|---|---|---|
| 1 | 4–6h | Foundation & output schema |
| 2 | 6–8h | AI prompt engineering & integration |
| 3 | 6–8h | Theme assembly (templates, patterns, `theme.json`, zip packaging) |
| 4 | 4–6h | Quality pass (tests, edge cases, vanilla-WordPress install check) |
| 5 | 2–4h | Documentation (README, ADR, "What I'd Do Next", final commit review) |

## Evaluation criteria

**Must have:**
- Theme generation produces a valid, runnable Block Theme
- Zero Custom HTML block usage
- AI integration provides structured output (JSON / Block Markup) reliably
- Robust validation of AI output structure
- Tests pass cleanly
- Clean, readable, well-structured code
- Strong commit history & PR discipline
- README, ADR, "What I'd Do Next"

**Raises the bar:**
- Visually high-quality, non-generic themes; sophisticated block usage (Query Loop patterns, advanced layout)
- Prompt engineering that produces consistently correct, detailed block markup
- ADR showing genuine product + architectural thinking on structured data generation
- "What I'd Do Next" that addresses the unique challenges of dynamic file generation

**Bonus (only after the above):**
- Live theme preview in-app
- Iteration UX (let user refine after preview)
- Pattern Library Integration

## Workflow this project uses

The dev loop here is the **autonomous research loop recipe**:

```
/loop /ce-ideate "<seed grounded in this brief>"
  → parallel: ce-web-researcher + ce-best-practices-researcher + ce-learnings-researcher
  → /ce-doc-review deepen
  → /sync-gbrain
  → fleshed PRD with citations
```

Seed context is load-bearing — every research loop pass must be grounded in this CLAUDE.md and the brief PDF. See `~/.claude/projects/-Users-jasondijols-Documents-Code-Projects-Automattic/memory/` for project memory.

## Session continuity & handoffs

Two complementary mechanisms:

1. **Every session end → `/context-save`** (gstack). Machine-local checkpoint; auto-surfaced next session by `/context-restore` and the gstack preamble's Context Recovery block. This is the resume button.
2. **At milestones** (end of a phase, a long autonomous run, a multi-hour session worth preserving) **→ commit `docs/handoffs/{YYYY-MM-DD}-{slug}.md`**. Durable, repo-resident narrative. Reference artifacts by path; never duplicate PRDs/ADRs/commits. Include: where we are, key decisions (linked), open/deferred questions, exact next steps, gotchas, suggested skills.

Not every session needs #2 — reserve it for milestones, or it becomes overhead. Decisions themselves live in ADRs + PRDs + `STRATEGY.md` + the commit history (all gbrain-indexed); handoffs are *continuity*, not decision records (so they do not belong in `docs/adr/`).

When this process is proven across a few milestones, skillify it for cross-project reuse via `write-a-skill` / `superpowers:writing-skills` — convention first, skill once the shape is stable.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas / brainstorming → invoke `/office-hours` or `/ce-brainstorm`
- Strategy / scope → invoke `/plan-ceo-review` or `/ce-strategy`
- Architecture / plan → invoke `/plan-eng-review` or `/ce-plan`
- Design system / plan review → invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline → invoke `/autoplan` or `/ce-doc-review`
- Bugs / errors → invoke `/investigate` or `/ce-debug`
- QA / testing site behavior → invoke `/qa` or `/qa-only`
- Code review / diff check → invoke `/review` or `/ce-code-review`
- Visual polish → invoke `/design-review`
- Ship / deploy / PR → invoke `/ship`, `/ce-ship`, or `/land-and-deploy`
- Save progress → invoke `/context-save`
- Resume context → invoke `/context-restore`

## Out of scope (for the MVP submission)

- WordPress.com integration / direct site deployment
- Multi-user accounts / saved theme history
- Visual theme editor (free-form drag-drop in the generated theme)
- Anything beyond the brief's "raises the bar" criteria

## Naming

**Decided: the product is named "Automattic."** It is a deliberate homage to [Automattic](https://automattic.com) — the parent of WordPress.com and the Partner evaluating this Gauntlet AI Challenger submission. The repo folder and the product's display name are both Automattic. This closes the earlier open TODO (which had floated generic candidates like Blocksmith, Strata, etc.); see ADR-0002 CP-24 for the decision record.

This is a conscious, accepted tradeoff, made with eyes open:

- **It is an homage, not a claim.** This is a portfolio piece by Jason Dijols — not an Automattic product nor an official Automattic project. That disclaimer is stated plainly in the README and ADR-0002 so the name reads as a tribute to the evaluator, not as passing-off.
- **Trademark.** "Automattic" is Automattic Inc.'s mark; it is used here as the project codename/homage for this submission only — no commercial use, no implication of endorsement. Any real public launch would revisit this.
- **The npm package id stays descriptive.** `package.json` keeps `name: "wp-block-theme-generator"` (a valid, generic npm identifier); the *product/brand* name is Automattic, the *package* id is descriptive. No repo-folder rename is needed — which also avoids breaking the gbrain project slug, memory paths, and any IDE/agent state pinned to the current path.

## Notes on AI tool usage

Per the brief: *"You're building an AI-powered product — it would be strange not to use AI to help build it. Use whatever tools make you most effective."* But AI-generated code must clear the same quality bar as anything else in this codebase. Both the AI's output (the theme) and the code that manages it (the app) must be high quality.

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite
- Config file: ~/.gbrain/config.json (mode 0600)
- Brain database: ~/.gbrain/brain.pglite
- gbrain version: 0.41.26.1 (upgraded from 0.18.2 on 2026-05-28; bun git checkout of github.com/garrytan/gbrain)
- Setup date: 2026-05-27 (brain re-initialized on voyage-code-3, 2026-05-28; old 0.18 brain preserved at `~/.gbrain/brain.pglite.bak-*`)
- MCP registered: yes (user scope). After the 0.18→0.41 upgrade, restart Claude Code so the `mcp__gbrain__*` tools reload against 0.41.
- Artifacts sync: off (re-enable with `gstack-config set artifacts_sync_mode artifacts-only`)
- Transcript ingest: incremental (new sessions auto-ingest; no historical bulk load)
- Current repo policy: unset; `origin` now exists (github.com/jdijols/automattic) + a `gitlab` mirror. Set a per-repo trust policy via `/setup-gbrain --repo` if desired.
- Embedding provider: **voyage:voyage-code-3** (1024-dim), set at re-init (`gbrain init --pglite --embedding-model voyage:voyage-code-3`). `VOYAGE_API_KEY` is exported in **`~/.zshenv`** so non-interactive shells / gbrain subprocesses see it — it was only in `~/.zshrc` before, which interactive shells read but gbrain's subprocess did not. Note: 0.41's *default* provider is ZeroEntropy; we explicitly use Voyage. PGLite bakes the embedding dimension at init, so switching models later requires a wipe + re-init + re-import.

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain over Grep when the question is semantic or when you don't know the exact identifier yet. Two indexed corpora available via the `gbrain` CLI:
- This repo's code (will register as `gstack-code-automattic` source after first `/sync-gbrain --full`)
- `~/.gstack/` curated memory (registered as `gstack-brain-jasondijols` source via the federation pipeline)

Prefer gbrain when:
- "Where is X handled?" / semantic intent, no exact string yet:
    `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
    `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
    `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
    `gbrain search "<terms>" --source gstack-brain-jasondijols`

Grep is still right for known exact strings, regex, multiline patterns, and file globs. The brain auto-syncs incrementally on every gstack skill start. Run `/sync-gbrain` to force-refresh, `/sync-gbrain --full` for full reindex.

<!-- gstack-gbrain-search-guidance:end -->

## Library docs (Context7)

Context7 is installed in **CLI + Skills mode** for both Cursor and Claude Code (`npx ctx7@latest setup` → `CLI + Skills`). The agent invokes it as shell commands; library docs arrive as text output, not MCP tool results.

**Installed surfaces:**
- `~/.cursor/skills/find-docs/SKILL.md` + `~/.cursor/rules/context7.mdc` (alwaysApply, Cursor)
- `~/.claude/skills/find-docs/SKILL.md` + `~/.claude/rules/context7.md` (Claude Code)
- `ctx7` is NOT globally installed — all invocations use `npx ctx7@latest <cmd>` per the rule. Optional: `npm install -g ctx7@latest` to skip the npx fetch overhead.

**Why CLI over MCP for this workflow:** subagent reachability. CE adversarial personas (`ce-framework-docs-researcher`, `ce-best-practices-researcher`, etc.), gstack researchers, and parallel-dispatched subagents have Shell access universally but not always MCP. The CLI path is reachable from every subagent type; the MCP path was only reachable from MCP-enabled callers. Bonus: `ctx7` invocations go through Cursor's Shell tool, so `rtk gain` tracks them.

**Two-step invocation** (per `find-docs` skill):
```bash
npx ctx7@latest library "<name>" "<user's question>"     # resolve → /org/project ID
npx ctx7@latest docs /org/project "<user's question>"   # fetch docs for that ID
```

Library IDs are slash-form (`/wordpress/wordpress`, `/vercel/next.js`). Version-specific form: `/org/project/version`. Pass the user's **full question** as the query — single words return generic results.

**Especially important for this project** (Gutenberg ships ~biweekly and the brief's disqualifying constraint is "no `wp:html` block, all output must be native block markup"):
- WordPress block syntax (`wp:paragraph`, `wp:cover`, `wp:query`, `wp:post-featured-image`, etc.) — verify against current Gutenberg before generating
- `theme.json` schema (v2 → v3 has live migrations) — never assume training-data field names
- `@wordpress/blocks`, `@wordpress/block-editor` APIs when writing helper code
- Whichever AI SDK we pick (Anthropic/OpenAI structured-output APIs shift between SDK versions)

**Hard rule from the skill:** do not silently fall back to training data when Context7 fails (quota, network) — surface the failure to the user. Skip Context7 entirely for refactoring, debugging business logic, code review, or general programming concepts — it's a docs primitive, not a thinking primitive. Cap at 3 ctx7 calls per question.

## Token efficiency (rtk)

[`rtk`](https://github.com/rtk-ai/rtk) is installed (`brew install rtk`, v0.42+) with the Cursor `preToolUse` hook wired at `~/.cursor/hooks.json`. **It runs silently** — Cursor rewrites every Shell tool call to its `rtk` equivalent before execution (e.g. `git status` → `rtk git status`), returning compressed output (60–90% smaller on git, tests, lints, builds). No agent action required.

Notes:
- Hook only intercepts Cursor's **Shell** tool, not native `Read`/`Grep`/`Glob` — those bypass rtk.
- Analytics: `rtk gain` (requires unsandboxed shell since DB lives at `~/Library/Application Support/rtk/`).
- Compounds across CE adversarial-review pipelines and gstack `/ship`, `/qa`, `/review` — every persona/subagent that shells out benefits.
- Uninstall: `rtk init -g --agent cursor --uninstall` then `brew uninstall rtk`.
