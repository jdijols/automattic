# Phase 1 Seed Prompt — Correctness Backbone PRD

> Seed for `/loop /ce-ideate`. The slash-command argument should simply tell `ce-ideate` to **execute this file**. Every iteration of the loop deepens `docs/phase-1-prd.md` against this seed; this seed itself is versioned, so iterations are reproducible.

## Grounding sources (read in this order, every iteration)

1. **`STRATEGY.md`** at repo root — product strategy. Target problem, the four tracks, the contractual invariant, the secondary personas explicitly out of primary scope.
2. **`CLAUDE.md`** at repo root — project context, the disqualifying constraint (no `<!-- wp:html -->`), required deliverables, evaluation criteria, hard rules.
3. **`References/Automattic_Project-Brief.pdf`** — the original assignment. Six pages.

If `STRATEGY.md` or `CLAUDE.md` has been updated since the previous iteration, re-read fully before proceeding. The seed prompt is not the ground truth — those documents are.

## Topic

Produce a Phase-1 PRD for the **correctness-backbone track** of this project: the schema, validator, and deterministic assembler that turn a constrained AI intermediate representation into a downloadable, vanilla-WordPress-installable Block Theme `.zip` — with a 100% catch rate on `<!-- wp:html -->`, hallucinated block names, and invalid `theme.json`.

This is `STRATEGY.md` → Track 1 (Schema, validator, and deterministic assembler) **plus** the IR contract that Track 3 (AI orchestration) consumes. Phases 2–5 of the brief get their own seed prompts when this one lands.

## Output

Write to `docs/phase-1-prd.md`. **If the file exists, deepen it. Do not overwrite.** Preserve section order; expand weak sections; add citations; sharpen open questions; record a brief decision log when a question is resolved.

**Section order (locked across iterations):**

1. **Goal** — what Phase 1 must deliver for Phase 2 (AI Prompt Engineering) to begin. Concrete, falsifiable.
2. **Intermediate Representation (IR)** — the typed contract between the AI and the pipeline. Schema definition, worked examples of what's expressible and what isn't.
3. **`theme.json` schema** — sourcing strategy (hand-author vs. embed-upstream vs. generate-from-source), WP-version target, drift strategy when WordPress ships new schema versions.
4. **Block-name allowlist + block-tree grammar** — which core blocks are in MVP scope (and which aren't, with reasons); how the block tree is validated; how unknown / hallucinated block names are rejected.
5. **Validator architecture** — per-layer vs end-to-end; validation ordering (IR → block tree → `theme.json` → assembled `.zip`); the structured error format the orchestrator (Track 3) consumes.
6. **Deterministic assembler** — IR → template files + patterns + `theme.json` + `.zip`; idempotency requirements; reproducibility across runs and across machines.
7. **Vanilla-WP install/activate test harness** — automated activation smoke test in a clean WordPress environment (candidates: WP-CLI in Docker, WordPress Playground / wasm, hosted WP). What counts as "zero warnings or errors." CI integration story.
8. **Contract exposed to Track 3 (AI orchestration)** — what shape the AI sees; how validation errors are fed back for retry; what the AI must NOT see (raw schema diffs, validator internals, IR-implementation churn).
9. **Open architectural questions** — minimum **four**, one per major component. Each must name a real fork in the road, not a rhetorical setup. Format spec below.
10. **Citations** — numbered, footnoted in-line throughout sections 1–9.

## Research dimensions (dispatch parallel)

- **`ce-web-researcher` → web / prior art.**
  AI structured-output frameworks: OpenAI function calling / structured outputs, Anthropic tool use, JSON mode, constrained decoding (Outlines, llguidance, XGrammar), Instructor, BAML, Pydantic AI. Existing AI block-theme / page generators: CodeWP, Extendify, Hello Biz, Divi AI, ElementorAI, Bricks AI — *especially how they fail* (silent `wp:html` escapes, hallucinated blocks, invalid `theme.json`, unrunnable themes). Runtime JSON validation: AJV, Zod, Valibot, ArkType against JSON Schema 2020-12.

- **`ce-best-practices-researcher` → WordPress conventions.**
  Authoritative sources only:
  1. `developer.wordpress.org/themes/global-settings-and-styles/` — `theme.json` reference
  2. `github.com/WordPress/gutenberg` — block.json conventions, block grammar parser source
  3. `developer.wordpress.org/block-editor/reference-guides/block-api/` — block API reference
  4. `make.wordpress.org/core` and `make.wordpress.org/themes` — RFC-equivalent decisions
  Cover: the block-grammar serialization format (HTML comments with `<!-- wp:NAMESPACE/NAME attrs -->`); FSE template hierarchy (`index.html`, `single.html`, `archive.html`, `page.html`, parts, patterns); the `theme.json` schema versioning history; `wp_is_block_theme()` / theme support flags; WP-CLI commands relevant to validation; WordPress Playground as a CI-grade install/activate harness.

- **`ce-learnings-researcher` → project learnings.**
  Re-read `STRATEGY.md` Track 1 specifics, the contractual invariant, the metrics owned by Track 1 + Track 3. Check `~/.claude/projects/-Users-jasondijols-Documents-Code-Projects-Automattic/memory/` for prior decisions. If any tracked architectural question has been resolved in a prior iteration, do not re-litigate it — cite the decision and move on.

## Citation policy

Every non-trivial claim about WordPress conventions or prior-art tooling MUST cite an upstream source. Source preference order:

1. Official WordPress documentation (`developer.wordpress.org`, `wordpress.org/documentation`)
2. WordPress / Gutenberg source repositories on GitHub (commit-pinned where the claim is version-sensitive)
3. The official source repo or docs of any cited library / framework
4. `make.wordpress.org` core-team blogs for RFC-equivalent decisions
5. Recent (≤ 18 months) blog posts from authoritative voices (only when 1–4 don't cover the claim)

**No citation = the claim does not appear in the PRD.** Bare assertions get cut on the next iteration.

## Open architectural questions

Mandatory. These are what `/ce-doc-review deepen` attacks next iteration. Each question must:

- Name two or more genuine alternatives with non-obvious trade-offs
- Identify which Track 1 invariant or metric is at stake
- Propose a recommendation OR mark `[unresolved]` with what evidence is needed to resolve

Examples of the right *shape* (not necessarily the right questions — surface your own):

- *"IR shape: mirror WordPress block grammar 1:1 vs. higher-level abstraction the AI can target without learning HTML-comment syntax. Trade: 1:1 keeps the assembler trivial but exposes the LLM to a more failure-prone surface; abstraction shifts complexity into the assembler."*
- *"`theme.json` schema source: hand-author the schema fragment vs. embed the canonical upstream schema as a build-time dependency vs. generate from `theme-i18n.json` + `theme.schema.json`."*
- *"Error feedback contract for retry: structured codes (machine-parseable, terse, may starve the LLM of context) vs. natural-language re-prompts (model-friendly, fuzzy, may leak validator internals) vs. both layered."*

## Out of scope (refuse if you drift)

- **Track 2** (pattern library curation, design tokens, distinctiveness rubric) — only mention where Track 1 must expose a contract.
- **Track 4** (UI input form, error display, download flow) — only mention where Track 1 must expose a contract.
- **Track 3 internals** (prompt construction, model choice, retry policy, cost budget) — the PRD names what Track 3 *consumes* from Track 1, not how Track 3 implements its end.
- **Implementation framework / language choice** — the PRD names the contract; "Node + Zod" vs "Rust + serde_json" vs "Python + Pydantic" is downstream.
- **Anything that loosens the `wp:html` catch invariant** — if a prior-art tool can't be adapted under that constraint, name it and move on.

If a research dimension surfaces strong material on an out-of-scope track, capture it as a single line under a "Forward references" appendix and link to where it will be picked up.

## Style

Technical, citation-dense, opinionated where the strategy provides cover, agnostic where it doesn't. Reviewer-grade — assume a senior Automattic engineer is the reader. Cut every sentence that doesn't move the PRD forward. No throat-clearing introductions. No "in conclusion" paragraphs.

## Iteration policy

- **First iteration**: produce all 10 sections at v0 quality. Mandatory: open architectural questions (section 9) and citations (section 10) must be present, even if thin.
- **Subsequent iterations**: deepen the weakest section first — defined as the section with the most `[TODO]`, `[unresolved]`, or uncited claims. Resolve **at least one** open architectural question per iteration (move it from section 9 to the body, leave a one-line decision log) and surface **at least one** new question to replace it.
- **Stop condition**: section 9 has been refreshed at least twice without new questions surfacing, AND citation count is stable, AND no `[TODO]` markers remain. When met, the PRD is ready for `/ce-plan`.
