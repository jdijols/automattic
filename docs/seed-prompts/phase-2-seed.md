# Phase 2 Seed Prompt — AI Orchestration (Track 3)

> Seed for `/loop /ce-ideate`. The slash-command argument tells `ce-ideate` to **execute this file**. Every iteration deepens `docs/phase-2-prd.md`. Versioned + reproducible, like the Phase 1 seed.

## Grounding sources (read in this order, every iteration)

1. **`docs/phase-1-prd.md`** — THE FROZEN CONTRACT. Track 3 *consumes* this; it does not redesign it. Specifically: §2.4 (the IR JSON Schema Track 3 must emit), §5.2 (the structured error format the retry loop consumes), §4.1 (the block allowlist injected into the prompt), §6.4 (the input-stage prompt-injection + URL/params escaping requirements), §8 (the contract exposed to Track 3), and **Q7** (recursive IR vs. hosted structured-output limits — explicitly handed to Track 3 to resolve).
2. **`STRATEGY.md`** — Track 3 "AI orchestration — model-facing surface"; the metrics Track 3 owns (first-try generation success, validator escape-attempt trend, median wall-clock latency); the contractual invariant.
3. **`docs/adr/0001-application-stack.md`** — Vercel AI SDK `generateObject` + Zod, default provider Anthropic Claude, swappable. The §8.1 envelope/content split (generateObject strict-validates the IR envelope; the recursive tree is post-hoc validated).
4. **`CLAUDE.md`** + **`References/Automattic_Project-Brief.pdf`** (Phase 2: "AI Prompt Engineering & Integration").

If `docs/phase-1-prd.md` changed since the last iteration, re-read it — the contract is the ground truth, not this seed.

## Topic

Produce a Phase-2 PRD for the **AI orchestration layer (Track 3)**: the component that turns the user's natural-language vision + structured criteria into a valid IR (the frozen Phase 1 contract), and recovers when validation fails. This is `STRATEGY.md` → Track 3 + the brief's Phase 2.

**The central question is Q7** — the Phase 1 PRD deferred it here: the IR's block tree is recursive and exceeds hosted structured-output nesting/recursion limits (OpenAI: no recursion, ≤5 nesting; Anthropic strict tool use: no recursion). Resolving Q7 (or designing the experiment that resolves it) is the spine of this PRD.

## Hard rule: the Phase 1 contract is frozen

Track 3 codes *against* the IR schema, error format, and allowlist — it does not change them. If research surfaces a genuine reason the contract is wrong (e.g. Q7 forces the flattened adjacency-list encoding, which *is* a §2.4 schema-shape change), do **not** silently diverge: write it as an explicit **CONTRACT-CHANGE-REQUEST** block naming the exact Phase 1 section affected, so it can be reconciled deliberately. Default posture: consume, don't redesign.

## Output

Write to `docs/phase-2-prd.md`. **If the file exists, deepen it. Do not overwrite.** Preserve section order; expand weak sections; add citations; sharpen open questions; record decision logs.

**Section order (locked):**

1. **Goal** — what Phase 2 delivers (a working orchestration layer that reliably emits valid IR) for integration to begin. Concrete, falsifiable.
2. **Generation architecture** — prompt construction (how the system prompt injects the §4.1 allowlist + pattern-catalog references + the IR schema); per-layer (region-by-region) vs. monolithic (whole-IR) generation; where pattern-reference vs. free-block-tree authoring is decided (the Q1 hybrid governance the Phase 1 PRD left to Track 3).
3. **Structured-output mechanism — resolves Q7** — `generateObject` + Zod for the IR *envelope* vs. the recursive *content* tree; the three Q7 options (CFG constrained decoding / flattened adjacency-list encoding / strict-envelope + post-hoc tree validation). Give the lean (Phase 1 leaned C) AND design the first-try-success experiment that confirms or flips it.
4. **Provider abstraction + model selection** — Vercel AI SDK as the swappability seam (ADR-0001); default Claude; which model tier (Opus vs. Sonnet vs. Haiku) for the cost/quality/latency trade; what a provider swap actually costs given the Q7 envelope/content split.
5. **Retry + error-feedback loop** — consume the §5.2 structured error format; retry budget; how a validator rejection becomes a re-prompt; convergence behavior; the "trust the parser" loop (generate → validate → re-prompt on failure).
6. **Input handling + prompt-injection defense** — the §6.4 requirement: user NL description passed as a structurally isolated data slot (delimited), never concatenated into instruction context; how structured criteria (color/typography/site-type) are encoded; defense against hostile attribute values steered by injection.
7. **Cost + latency budget** — per-generation token/cost/latency; how the three Track-3-owned metrics are instrumented (first-try success, escape-attempt trend, p50 latency); the retry-budget's effect on latency.
8. **Contract exposed downstream** — what Track 4 (UI) and integration consume from Track 3 (generation status, the §5.2 errors surfaced legibly, progress signals).
9. **Open architectural questions** — minimum 4, one per major component. Same format as the Phase 1 PRD (≥2 alternatives, stakes, recommendation or `[unresolved]` + evidence needed).
10. **Citations** — numbered, footnoted in-line.

## Research dimensions (dispatch parallel)

- **`ce-web-researcher` → structured-output + prompt-engineering prior art.** OpenAI Structured Outputs (recursion/nesting limits, strict mode), Anthropic strict tool use + structured outputs, Vercel AI SDK `generateObject` internals; constrained-decoding CFG engines (llguidance, XGrammar) and whether hosted providers expose them; recursive-schema workarounds (adjacency-list / flattened-tree encodings) in real systems; text-to-structured-output prompting patterns; self-correction / validator-in-the-loop retry patterns; prompt-injection defenses (delimiters, spotlighting, instruction/data separation).
- **`ce-best-practices-researcher` → SDK + provider docs.** Vercel AI SDK `generateObject` / `streamObject` + Zod schema constraints and limits; Anthropic + OpenAI structured-output API references (the exact recursion/nesting/union caps); model tier cost + latency characteristics (Opus/Sonnet/Haiku, GPT tiers); prompt-caching for the static allowlist + schema prefix.
- **`ce-learnings-researcher` → the frozen contract + project memory.** Re-read `docs/phase-1-prd.md` (§2.4, §5.2, §4.1, §6.4, §8, Q7), `STRATEGY.md` Track 3, `ADR-0001`, and `~/.claude/projects/-Users-jasondijols-Documents-Code-Projects-Automattic/memory/`. Treat the Phase 1 contract as fixed input.

## Citation policy

Same as Phase 1: every non-trivial claim about a provider's structured-output behavior, the AI SDK, or a prompt-engineering technique MUST cite an upstream source (official provider/SDK docs > source repos > recent authoritative posts). No citation = the claim does not appear.

## Out of scope (refuse if you drift)

- **Track 1 internals** (the validator, assembler, serializer) — frozen contract; reference it, don't redesign it.
- **Track 2** (pattern library curation) — Track 3 *references* patterns by slug; it doesn't author them.
- **Track 4** (UI implementation) — name only the contract Track 3 exposes to it.
- **Phase 1 / Phase 3 implementation code** — this is a PRD, not an implementation.
- **Re-opening resolved Phase 1 questions** (Q1–Q6, Q8, Q10) — unless a CONTRACT-CHANGE-REQUEST is genuinely warranted (rare; flag explicitly).

## Open architectural questions

Mandatory, ≥4. These are what a future `/ce-doc-review` attacks. Each: ≥2 genuine alternatives, the invariant/metric at stake, a recommendation or `[unresolved]` with the evidence needed. Q7's resolution is the headline; surface the downstream questions it opens (retry-budget policy, per-region vs. monolithic generation, model-tier selection under the cost metric).

## Style

Technical, citation-dense, opinionated where the strategy/contract gives cover, agnostic where it doesn't. Reviewer-grade — a senior Automattic engineer is the reader. No throat-clearing.

## Iteration policy

- **First iteration**: all 10 sections at v0; section 9 + citations mandatory even if thin. Resolve Q7 to a leaning + an experiment design (don't leave it merely restated).
- **Subsequent iterations**: deepen the weakest section first; resolve ≥1 open question per pass (decision log) and surface ≥1 new one.
- **Stop condition**: section 9 stable across two passes with no new questions, citations stable, no `[TODO]` markers → ready for `/ce-plan`. On stop, send a PushNotification and halt (no further wake-up).
