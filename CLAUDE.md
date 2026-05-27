# CLAUDE.md — Automattic Challenger Project

This file is the canonical project context for any AI coding agent (Claude Code, OpenClaw, Codex, Cursor) operating in this repo. Read it before doing anything else.

## What this project is

A **Gauntlet AI Partner Project — Challenger submission** for Automattic: an AI-powered **WordPress Block Theme Generator**.

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

## Notes on AI tool usage

Per the brief: *"You're building an AI-powered product — it would be strange not to use AI to help build it. Use whatever tools make you most effective."* But AI-generated code must clear the same quality bar as anything else in this codebase. Both the AI's output (the theme) and the code that manages it (the app) must be high quality.

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite
- Config file: ~/.gbrain/config.json (mode 0600)
- Brain database: ~/.gbrain/brain.pglite
- gbrain version: 0.18.2
- Setup date: 2026-05-27
- MCP registered: yes (user scope, `mcp__gbrain__*` tools available after Claude Code restart)
- Artifacts sync: off (re-enable with `gstack-config set artifacts_sync_mode artifacts-only`)
- Transcript ingest: incremental (new sessions auto-ingest; no historical bulk load)
- Current repo policy: unset (no `origin` remote — policy will be set when remote is added)
- Embedding provider: gbrain auto-selected (set `VOYAGE_API_KEY` for voyage-code-3, the gstack default for code retrieval)

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
