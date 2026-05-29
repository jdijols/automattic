# ADR-0002: AI Theme-Generation Architecture

- **Status:** Accepted
- **Date:** 2026-05-29
- **Deciders:** Jason Dijols
- **Related:** [ADR-0001 — Application Stack](0001-application-stack.md); `docs/phase-1-prd.md`; `docs/phase-2-prd.md`; `STRATEGY.md`; the frozen interface under `contract/` (`contract/ir-v1.schema.json`, `contract/allowlist.json`, `contract/prompt-contract.md`, `contract/error-format.md`)

> ADR-0001 records the foundational stack decision (Next.js App Router, TypeScript strict, Vercel AI SDK + Zod, AJV, Vitest, JSZip, WordPress Playground, npm) and stays in force. This ADR builds on it and cross-references it; it does not restate the stack rationale. Where this document needs a stack fact, it links rather than duplicates.

> **Companion deliverables.** The brief grades several documents that live alongside this ADR and are cross-referenced (not duplicated) throughout: [`docs/what-id-do-next.md`](../what-id-do-next.md) (the brief's required "What I'd Do Next" roadmap — priorities, production gaps, scaling), `STRATEGY.md` (the product's problem, approach, users, metrics, and tracks of work), `docs/phase-1-prd.md` (the Track-1 correctness-backbone PRD), `docs/phase-2-prd.md` (the Track-3 AI-orchestration PRD), and the frozen interface under `contract/`. §8 below records the open decisions as a terse architectural-status list; [`docs/what-id-do-next.md`](../what-id-do-next.md) is the authoritative roadmap for that work.

---

## 1. Executive summary

This system turns a natural-language site description plus structured criteria (color palette, typography) into a complete, valid WordPress Full Site Editing (FSE) block theme, packaged as an installable `.zip`. The architecture rests on one posture established at the first checkpoint and never relaxed: **trust the parser, not the prompt.** Model output is treated as untrusted, schema-validated input. The prompt constrains generation; a layered validator and a deterministic assembler enforce correctness regardless of what the model emits.

End to end, a request flows through four seams:

1. **Server seam** (`app/api/generate/route.ts` → `src/orchestration/limits.ts`) — rate limit, input-length cap, structured-criteria validation, and a spend guard run before any provider call. The credential never reaches the client.
2. **AI orchestration** (`src/orchestration/`) — a swappable provider seam (`provider.ts`, default Anthropic Claude Sonnet 4.5 behind the Vercel AI SDK) calls `generateObject` against an envelope-strict Zod view of the IR (`ir-views.ts`), inside a bounded 3-attempt retry loop (`retry-loop.ts`) that re-prompts on validation failure.
3. **Layered validator** (`src/validator/`) — the authoritative gate. Four fail-closed layers (schema → block-tree → theme.json → assembled-artifact byte scan) turn a candidate into either a validated IR or a legible, machine-branchable error list. No candidate is ever returned or assembled without clearing it.
4. **Deterministic assembler + install gate** (`src/assembler/`, `src/harness/`) — a six-step pipeline serializes the validated IR to byte-reproducible theme files and a `.zip`, with per-output-context injection defenses; a headless WASM WordPress Playground gate installs, activates, and asserts the rendered result.

**Headline decisions:**

- **Output format:** native WordPress block markup + `theme.json` v3 — never the Custom HTML block, never raw HTML/PHP templates, never page-builder JSON.
- **Reliability mechanism:** "envelope-strict / tree-best-effort + post-hoc validation" (Option C). The flat envelope is strictly validated at generation time; the recursive block tree is best-effort at generation and fully enforced by the validator. Provider-independent by construction.
- **Creativity mechanism:** compose curated, don't invent. A hand-authored, Playground-validated pattern library is the source of taste; the model selects and parameterizes patterns (and hand-builds only for gaps).
- **Provider:** swappable in one line; default Anthropic Claude Sonnet 4.5; OpenAI `gpt-5.1` is the named warm swap target.
- **The disqualifying `wp:html` constraint** is enforced in depth at five independent points (allowlist, validator layers, two shared-detector byte scans, render-time assertion) — it is not weakenable.
- **Determinism:** STORE (not DEFLATE) zip compression, fixed timestamps, NFC/LF normalization, a committed golden `.zip` asserted byte-for-byte in CI.

**Current status (honest):** The orchestration spine, the validator, the assembler, the byte-reproducible zip, and the Playground gate all exist and are tested. **The HTTP route currently returns the validated IR as JSON; it does not yet call the assembler or return a downloadable `.zip`.** All three downstream pieces (assembler, zip packaging, install gate) are verified independently but are not yet wired at the HTTP boundary. There is also no front-end input UI yet (Track 4 is unbuilt — the server seam exists, the form does not). The C-single vs. C-decomposed generation arm is not locked: the §3.6 first-try-success experiment (issue #23) awaits a real-provider run, and C-single — the guaranteed-correct floor — is the current default. These are tracked next steps, indexed in §8 and detailed in [`docs/what-id-do-next.md`](../what-id-do-next.md). (The product name is settled — "Automattic" as homage — see CP-24.)

---

## 2. Decision timeline / checkpoints

This is the narrative spine. Each checkpoint gives **Context → Decision → Why** (and what it superseded). The thematic deep-dives in §3–§7 are referenced inline and should be read as the depth behind this spine, not a repetition of it.

### CP-1 — Stack foundation (2026-05-27)

- **Context:** A standalone, reviewer-runnable AI app that handles a provider secret server-side and produces WordPress-specific output.
- **Decision:** Node 20+, TypeScript strict, Next.js App Router, Vercel AI SDK `generateObject` + Zod, AJV, Vitest, JSZip, WordPress Playground, npm. Recorded in full in **ADR-0001**.
- **Why:** Server-side secret handling, one-repo/one-deploy, and the brief's hard `npm test`-must-just-work requirement. See ADR-0001 for the complete rationale; this ADR does not restate it.

### CP-2 — Provider and model default (2026-05-27)

- **Context:** The brief mandates a swappable provider.
- **Decision:** Anthropic Claude (Sonnet tier) as default behind the Vercel AI SDK seam; OpenAI `gpt-5.1` as the named first swap target. The specific Claude tier was deferred to the Phase-2 experiment.
- **Why:** The Vercel AI SDK makes the provider a one-line change, satisfying the swappability requirement without bespoke abstraction. Deep-dive in **§3.1**. Realized in `src/orchestration/provider.ts` as the single line `defaultModel()` returns.

### CP-3 — IR shape: free tree vs. pattern-composition vs. hybrid (2026-05-27)

- **Context:** How should the model express a theme? Three candidates: a free recursive block tree (Option A), a pure pattern-composition IR (no free-tree), or a hybrid.
- **Decision:** **Hybrid** — `patternRef` as the default authoring mode plus a constrained `blockNode` free-tree for regions no pattern covers.
- **Why:** A free tree reintroduces the full hallucination surface (invented block names, `core/missing`, `wp:html` escapes). A pattern-only IR is maximally safe but caps the MVP to the exact coverage of the seed library and makes uncovered regions fail loudly rather than degrade. The hybrid takes the safety of curated patterns as the default and keeps the free-tree as a governed gap-filler. This was unblocked by Track 2's `meta.json` parameterizable/locked split. Superseded the implicit "let the model author everything" assumption. Realized in `src/ir/schema.ts` (`nodeSchema = z.union([blockNodeSchema, patternRefSchema])`).

### CP-4 — Validator as authority; trust the parser, not the prompt (2026-05-27)

- **Context:** What component is the source of truth for "is this theme valid?" — the prompt, the editor registry, or a standalone gate?
- **Decision:** A **standalone allowlist + containment grammar** is the fast inner authority (`src/validator/`, `src/blocks/`); WordPress Playground `parse_blocks()` is the authoritative outer backstop (`src/harness/`). The prompt is treated as advisory only.
- **Why:** Registry-backed `@wordpress/blocks` `getBlockType`/`validateBlock` assumes a hydrated browser-ish JS runtime, provides no containment checks (core enforces containment only in the inserter, not the parser), and couples validation to one language. A standalone gate runs in milliseconds in the inner loop; Playground (seconds, real WordPress) guards the CI boundary. This checkpoint is the foundational posture the whole architecture inherits — see **§3.2**. Realized as the four-layer pipeline in `src/validator/index.ts`.

### CP-5 — No-`wp:html` enforcement strategy (2026-05-27)

- **Context:** The single most-emphasized, disqualifying constraint in the brief: the generated theme must not use the Custom HTML block (`wp:html`) for any structural or visual element.
- **Decision:** Enforce it in **depth across independent layers**, not in one place: (1) the allowlist excludes `core/html`; (2) the IR schema makes it structurally unrepresentable; (3) the validator rejects it; (4) the assembler runs a layer-4 byte scan over `templates/*.html`, `parts/*.html`, `patterns/*.php` using a shared detector, plus a pre-substitution blob-integrity scan; (5) the Playground gate asserts zero `core/html` at render time. A `text` field that merely *mentions* the block is HTML-escaped and rendered as visible prose — neutralized, not rejected.
- **Why:** A single chokepoint can regress; independent layers catch distinct failure modes (a steered model, a mutated pattern blob, a serializer bug, undelimited raw HTML). Deep-dive in **§6.2**. This constraint is never described as weakenable.

### CP-6 — Output format: native block markup + `theme.json` v3 (2026-05-27)

- **Context:** What artifact format does the generator emit?
- **Decision:** Native WordPress block markup (`<!-- wp:… -->` comment-delimited HTML) for templates/parts/patterns, plus a `theme.json` version 3 document compiled from the IR's design tokens.
- **Why:** Native markup installs on any vanilla WordPress 5.9+ with no plugins (the standalone constraint). For the `theme.json` *schema source*, the upstream draft-07 schema was vendored from the Gutenberg repo, pinned by commit and SHA-256, and validated with AJV (`src/themejson/load-schema.ts`, `src/themejson/schema/theme-v3.json`) — a hand-authored fragment would drift, and generating from `theme-i18n.json` is a category error (it is an i18n key map, not a structural schema). Alternatives (Custom HTML block, raw HTML/PHP classic themes, page-builder JSON) are rejected in **§4**. Realized in `src/themejson/compile.ts`.

### CP-7 — Serialization parity oracle (2026-05-27)

- **Context:** The free-tree path must emit byte-exact WordPress markup; reimplementing each block's `save()` is a perpetual drift hazard.
- **Decision:** Delegate serialization exclusively to `@wordpress/blocks` `serialize()` (the "parity oracle"), exact-pinned at `15.20.0`. Use pre-serialized pattern blobs with structured token/slot substitution for covered regions.
- **Why:** Gutenberg's own serializer is the only authority that stays correct as block `save()` implementations evolve; the pin makes a lockfile bump fail loudly (the golden-zip test asserts the resolved version) rather than silently regenerate canonical bytes. Superseded any notion of a hand-rolled serializer. **Security note carried from the module:** `serialize()` does not escape RichText/HTML attributes — callers must escape untrusted strings first (handled by §6.1). Realized in `src/assembler/serializer.ts`.

### CP-8 — Structured error format frozen (2026-05-27, U7)

- **Context:** The retry loop needs a failure signal that a machine can branch on without leaking validator internals to the model.
- **Decision:** A both-layered error: machine `code` (closed 20-value enum) / `layer` / `path` / `invariant`, plus a bounded (≤200-char, whitespace-collapsed) natural-language `hint`. Published in `contract/error-format.md`; constructed by `makeError` in `src/validator/errors.ts`.
- **Why:** Codes-only starves a re-prompt of steering; raw Zod/AJV dumps leak schema fragments and inflate tokens. The closed enum lets `buildReprompt` map each code to a deterministic correction phrase. Realized as `ValidationError` in `src/validator/errors.ts`. **Contract/implementation gap to note:** the frozen enum declares all 20 codes whole, but one of them — `HEADING_OUTLINE` — has a reprompt-guidance entry yet **no producer anywhere in `src/`** (layer 2b emits only `REGION_NOT_UNIQUE`, `DANGLING_TOKEN_REFERENCE`, and `MULTIPLE_H1`). It is a reserved code held against a future heading-outline check; the count of 20 is correct, but a reviewer reading the enum should know one slot is intentionally unwired today.

### CP-9 — Install harness choice (2026-05-27)

- **Context:** The brief requires the theme to activate cleanly in vanilla WordPress; how is that proven?
- **Decision:** Headless WASM WordPress via `@wp-playground/cli` (pinned WP 6.6 / PHP 8.2), not Docker or a hosted WP instance. A four-assertion gate (clean activation, zero undelimited/`core/missing`/`core/html` chunks, zero dropped `theme.json` keys, non-empty navigation).
- **Why:** The standalone constraint was decisive — no external service may be required to run the app or its tests. **Drift note:** ADR-0001 anticipated Playwright for e2e; the realized e2e harness is this headless WASM Playground gate (`src/harness/run.ts`, `tests/e2e/`, `tests/harness/`). **There is no Playwright dependency in `package.json`.** Anywhere ADR-0001 implies Playwright, this gate supersedes it.

### CP-10 — Attribute-schema sourcing (2026-05-27)

- **Context:** Per-block attribute validation needs both a key/type surface and correctness-critical value bounds.
- **Decision:** Extract the key/type surface from core `block.json` at build time, plus a hand-authored value-range overlay for bounds that `block.json` does not express (e.g. `heading.level ∈ 1..6`, `cover.dimRatio ∈ 0..100`).
- **Why:** `block.json` carries attribute keys and types but not semantic ranges. Realized in `src/blocks/attributes.ts`, applied at validator layer 2a.

### CP-11 — Contract frozen; Q7 handed to Track 3 (2026-05-27, U7)

- **Context:** Track 1 (correctness backbone) and Track 3 (orchestration) needed a stable interface to develop against in parallel.
- **Decision:** Freeze the IR JSON Schema, the block allowlist, the structured error format, and the prompt-construction trust boundary under `contract/`. Explicitly hand the open question of "recursive IR vs. hosted structured-output depth limits" (Q7) to Track 3 to resolve.
- **Why:** A frozen contract is the seam that lets two tracks proceed without lockstep. The 20-code error enum and `Invariant` union were declared whole at this freeze even though the layer-3 and layer-4 producers landed later. See ADR-0001's "Contract reconciliation."

### CP-12 — Q7 resolved: reliable-yet-creative prompting (Option C) (2026-05-28)

- **Context:** The recursive block tree routinely exceeds the 5-level nesting cap that every hosted structured-output mode enforces (OpenAI permits recursion but retains a depth cap; Anthropic forbids recursion outright). No provider can strict-validate the deep tree.
- **Decision:** **Option C — envelope-strict / tree-best-effort + post-hoc validation.** Split one source schema into two views (`src/orchestration/ir-views.ts`): the **generation view** (`irGenerationSchema`) strictly validates the flat envelope but sends `content` as `z.array(z.unknown())`; the **validation view** (`IRValidated`, from the Track-1 validator) enforces every value range, URL safe-scheme, depth/count bound, and the `wp:html`-impossibility post-hoc. C-single (monolithic, one call) is the MVP default; C-decomposed (per-region) is the measured escalation arm.
- **Why:** Provider-independent by construction — the same mechanism holds regardless of which provider is swapped in, which is precisely why it beat the alternatives. Option A (CFG constrained decoding) needs a self-hosted grammar endpoint that no hosted provider exposes; Option B (flattened adjacency-list IR) is a contract-shape change forcing a Track-3 rewrite. Both rejected/deferred in **§4**. Deep-dive in **§3.3**.

### CP-13 — C-single vs. C-decomposed lean (2026-05-28, Q11)

- **Context:** Within Option C, does the MVP generate the whole IR in one call or decompose per region?
- **Decision:** **C-single** (monolithic) as MVP default; C-decomposed as the first optimization lever, selectable at one config point in `src/orchestration/index.ts`.
- **Why:** The pattern-reference bias keeps monolithic output shallow (most content is `patternRef` + flat `params`, not deep recursion), so decomposition's ~10pp accuracy benefit (DIN-SQL prior art) may not be needed. The §3.6 experiment measures both before the arm is locked. Trade-off detailed in **§5**. Realized: `src/orchestration/generate.ts` (C-single) and `src/orchestration/decomposed.ts` (C-decomposed).

### CP-14 — Model-tier selection (2026-05-28, Q13)

- **Context:** Which Claude tier, and is a split-tier worth it?
- **Decision:** Sonnet 4.5 as the single default tier. Split-tier (Haiku envelope + Sonnet tree) and Opus-on-retry deferred to a Phase-4 optimization pending a first-try-success baseline.
- **Why:** Sonnet is the cheapest tier that reliably produces detailed, structurally-valid markup; Opus carries ~35% tokenizer inflation and ~5× cost for reasoning the pattern-first design largely removes. No speculative tier optimization without a baseline. Deep-dive in **§3.1**.

### CP-15 — Retry budget and policy (2026-05-28, Q12)

- **Context:** How many re-prompts, and what is the last-resort behavior?
- **Decision:** `RETRY_BUDGET = 3` (1 initial + 2 retries). The final attempt adds a pattern-only fallback (`PATTERN_ONLY_INSTRUCTION`: build the page only from catalog pattern references). The full prior error list (not just the first error) is fed to every retry.
- **Why:** Three attempts is the practitioner norm; feeding the full error list is anti-oscillation; the pattern-only final attempt trades distinctiveness for a guaranteed-valid output. Only actionable validation failures are retried — transient provider errors (timeout, rate-limit, network) propagate as throws because re-prompting cannot fix a rate limit. Realized in `src/orchestration/retry-loop.ts` and `src/orchestration/reprompt.ts`.

### CP-16 — Latency budget as a non-circular gate (2026-05-28)

- **Context:** The §3.6 arm-selection experiment needs a fixed target so its decision rule is not circular.
- **Decision:** p50 ≤ 30 s first-try; p95 ≤ 90 s including the retry budget — asserted up front.
- **Why:** Fixing the budget before the experiment runs prevents the arm comparison from rationalizing whatever latency it happens to observe. Realized as the latency filter in `experiments/first-try-success/run.ts`.

### CP-17 — Authoring-mode governance dial (2026-05-28, Q14)

- **Context:** How hard should the prompt push pattern-first vs. allow free-tree?
- **Decision:** Pattern-first, free-tree-narrow — but the dial is only defensible once the Track 2 library has minimum breadth, and it must be co-tuned against the distinctiveness proxy, not first-try success alone.
- **Why:** On a 3-pattern seed, pattern-first produces repetitive output; tuning it purely for validity would silently collapse variety. Deep-dive in **§7**.

### CP-18 — Distinctiveness as a co-equal secondary gate (2026-05-28, Q15)

- **Context:** Optimizing the orchestration layer for first-try validity alone risks collapsing output toward a few near-identical compositions.
- **Decision:** Track 3 emits a pattern/composition diversity proxy (`diversity` telemetry event: distinct `patternRef` slugs, distinct region compositions per N generations). It is a co-equal gate in the §3.6 decision rule.
- **Why:** A validity-only objective degrades the thing the product is graded on. The distinctiveness *verdict* stays with Track 2's human panel rubric; the proxy prevents Track 3's optimization from degrading it silently. Deep-dive in **§7**. Realized in `src/orchestration/telemetry.ts`.

### CP-19 — Effort allocation: time-box Track 1, redirect to Track 2 (2026-05-28)

- **Context:** After nine PRD iterations, the Track 1 correctness backbone was at diminishing returns; its value is binary (it either catches a violation or it does not).
- **Decision:** Time-box Track 1 past the corpus + property tests and redirect remaining budget to Track 2 pattern breadth.
- **Why:** `STRATEGY.md` names Track 2 the highest-leverage-per-hour track; once Track 1's catch rate is proven, its marginal return on the grade approaches zero. This is also why blocks like `core/media-text`/`core/gallery` are *not* pre-admitted — see **§5**.

### CP-20 — Deterministic, byte-reproducible assembly complete (2026-05-29, U9)

- **Context:** The assembled `.zip` must be reproducible so a golden-file test can assert exact bytes and catch cross-environment regressions.
- **Decision:** STORE (not DEFLATE) compression, fixed UTC epoch timestamps, pinned permission/platform bits, NFC path + LF content normalization, lexicographic entry ordering. Per-output-context injection defenses live in the assembler. A committed golden `.zip` (`src/assembler/golden/aurora-blog.zip`) is asserted byte-for-byte in CI.
- **Why:** DEFLATE output varies by zlib version/platform; STORE is byte-exact. Trade-off (archive size for reproducibility) accepted in **§5**; injection defenses detailed in **§6.1**. Realized in `src/assembler/zip.ts` and the six-step pipeline in `src/assembler/index.ts`.

### CP-21 — Playground install/activate gate complete (2026-05-29, U10)

- **Context:** Prove the assembled archive installs and renders in real WordPress.
- **Decision:** A four-assertion headless-WASM gate (CP-9) wired as the slow CI gate, plus the U11 full-pipeline e2e test. CI is split fast/slow.
- **Why:** The byte scan is a static defense; the render gate is its runtime complement (it catches undelimited raw HTML that parses as `core/missing`, a serializer bug, or a malformed blob at render time). Realized in `src/harness/blueprint.ts` + `src/harness/run.ts`; CI split across `ci.yml` (fast) and `ci-playground.yml` (slow).

### CP-22 — C-decomposed arm + §3.6 experiment harness built; Q7 confirm/flip → HITL (2026-05-29)

- **Context:** The arm recommendation requires a live-provider measurement that consumes real tokens.
- **Decision:** Build the C-decomposed arm (`src/orchestration/decomposed.ts`) and the §3.6 experiment harness (`experiments/first-try-success/`); lock the final C-single-vs-C-decomposed confirm-or-flip to a human-in-the-loop step (issue #23). C-single remains the default until then.
- **Why:** C-single is the guaranteed-correct floor and does not depend on the experiment to be sound; flipping the arm is a one-line config change once the data exists. Open item detailed in **§8**.

### CP-23 — Server-seam opsec (2026-05-29)

- **Context:** A public HTTP endpoint that spends provider budget per request is a cost-DoS and credential-exposure surface.
- **Decision:** Four guards in `src/orchestration/limits.ts`, applied in order before any provider call — rate limiter (30 req/min/client, bounded key map), input-length cap (4000 chars), structured-criteria validation, spend guard (fails closed, refunds on transient error). The credential is read server-side only by the SDK and is scrubbed from any error before logging.
- **Why:** A crafted always-rejecting description otherwise drains budget; an unbounded key map is itself a memory-DoS. Deep-dive in **§6.4**. Realized in `src/orchestration/limits.ts` and `app/api/generate/route.ts`.

### CP-24 — Product name: "Automattic" as homage (2026-05-29)

- **Context:** The product name had been an open TODO, with generic candidates (Blocksmith, Strata, …) and an earlier note flagging that shipping under "Automattic" could read as a trademark/optics risk with the evaluator.
- **Decision:** Name the product **Automattic** — a deliberate homage to the evaluating Partner — and close the TODO. State plainly (README, this ADR, `CLAUDE.md`) that it is a portfolio piece, *not* an Automattic product or official project; keep the npm package id descriptive (`wp-block-theme-generator`); no repo-folder rename.
- **Why:** The earlier optics concern is resolved by framing, not avoidance — an explicit "homage, not affiliation" disclaimer makes the name a tribute rather than passing-off, with no commercial use and no claim of endorsement. Accepted as a conscious tradeoff (the author's call); any real public launch would revisit it. Supersedes the "pick a real name" guidance in `CLAUDE.md`'s Naming section.

---

## 3. Key technical decisions

The timeline above is the spine; this section is the depth for the three decisions the brief grades most heavily.

### 3.1 AI model and provider choice

**Decision.** The provider is one line — `defaultModel()` in `src/orchestration/provider.ts` returns `anthropic("claude-sonnet-4-5")`. The default is Anthropic Claude Sonnet 4.5 via `@ai-sdk/anthropic`; OpenAI `gpt-5.1` is the named warm swap target. Swapping providers is a one-line change; the schema, call policy, and result shape are untouched.

**Why Vercel AI SDK as the seam.** The brief mandates a swappable provider. The Vercel AI SDK's `generateObject` + Zod gives that for free and returns schema-validated structured output directly — no bespoke abstraction to build and maintain. A direct Anthropic/OpenAI SDK would force us to build the swap abstraction anyway (see §4).

**Why Sonnet, not Opus or Haiku.** Sonnet is the cheapest Claude tier that reliably produces detailed, structurally-valid block markup (Anthropic guidance: Sonnet for most production workloads, Opus for the hardest reasoning). At roughly $3/$15 per Mtok, a single uncached generation is about $0.08. Opus was considered as an "Opus-on-retry" escalation and rejected for the MVP (~35% tokenizer inflation, ~5× cost) — the pattern-first design removes most of the reasoning that would justify it. Haiku was considered for a split-tier (envelope only) and deferred as a Phase-4 optimization that needs a first-try-success baseline first (CP-14).

**The four boundary obligations the seam owns** (R8, in `provider.ts`), on every call:

| Obligation | Mechanism | Why |
|---|---|---|
| Never unbounded generation | `maxOutputTokens: 8192` | Bounds per-call cost and runaway output |
| No hung-provider wedge | `AbortSignal.timeout(60_000)` composed with caller signal | A stalled provider cannot wedge the retry loop |
| Warm cache | `cacheControl: { type: "ephemeral", ttl: "5m" }` set via `providerOptions` **on the `system` message** | The code (and its own comments) attach this to the system *message*; the Vercel AI SDK then converts it to a content-block-level `cache_control` on the Anthropic wire (Anthropic caches at content-block granularity). Placement on the message is load-bearing because a call-level `cacheControl` would be a silent no-op |
| Failure classification | `NoObjectGeneratedError` → structured `GenerateFailure` carrying `finishReason` | Lets the retry path distinguish truncation (`"length"` → raise cap) from a schema miss; all other errors propagate as throws |

Structured-output strategy is set via the Anthropic-specific `structuredOutputMode: "auto"` provider option (not the dead v4 `mode` parameter).

### 3.2 Reliable-yet-creative guidance

The model is steered toward correctness by the **instruction layer** and toward distinctiveness by **creative latitude**, with the validator as the non-negotiable backstop. The split is explicit:

| Hard-constrained (system prefix + schema) | Left free (creative latitude) |
|---|---|
| Block allowlist (full enumeration injected) | Which allowlisted blocks to use, and how to compose them within the grammar |
| Containment grammar (what nests where) | Whether to use a pattern reference (encouraged) or hand-build a tree for an uncovered section |
| Attribute ranges (heading level 1–6, cover `dimRatio` 0–100, URL scheme whitelist) | Theme metadata (title, description, author) |
| Custom HTML block explicitly prohibited | Color palette and typography if not pinned by structured criteria |
| IR schema conformance (enforced by `generateObject`) | Section layout — hero composition, column count, spacing — within the grammar |
| "Emit only the IR object" | Token *values* (must be declared in the IR `tokens` palette) |

Six mechanisms make the constrained side reliable:

1. **Trust the parser, not the prompt** (the foundational posture, CP-4): the prompt constrains, the validator enforces. A model that "tries to" emit `core/html` cannot succeed — see §3.3 and §6.2.
2. **Allowlist injection** (the Text-to-SQL analogy): the full block allowlist is injected as an explicit enumeration so the model selects from real names rather than hallucinating — the same "schema linking" technique DIN-SQL uses for table/column lists.
3. **Category-tagged token/slot system:** `patternRef.params` carry a `kind` discriminator (`tokenRef | text | url | scalar`). This is structured substitution applied by the *assembler*, not free string interpolation by the model — the model fills slot values; it never writes a block delimiter.
4. **Pattern library as the source of taste** (§7): the model selects and parameterizes pre-validated patterns rather than inventing layouts.
5. **Cacheable, isolated prompt construction** (below).
6. **The retry loop closes the trust-the-parser loop** (CP-15): the structured error format becomes the deterministic retry signal.

**Prompt construction** (`src/orchestration/prompt.ts`, `src/orchestration/context-prefix.ts`). Every call has two parts:

- **`system` — the cacheable prefix.** Assembled by `buildContextPrefix()` entirely from frozen-contract constants (the allowlist, containment grammar, pattern catalog with slots + token vocabulary, inter-slot rules, authoring-mode policy). No user input, no clock, no randomness. The output is **byte-identical across every call** — the precondition for the single 5-minute cache breakpoint at its end. It declares the role ("You generate a WordPress block theme as a typed IR object"), enumerates the allowlist, states the containment grammar and attribute rules, presents the pattern catalog in pattern-first mode, and explicitly prohibits the Custom HTML block and any out-of-allowlist block.
- **`prompt` — the variable suffix.** The user's text and structured criteria in isolated, delimited slots: `<user_description>{htmlEncoded(userDescription)}</user_description>` and `<structured_criteria>{JSON.stringify(validatedCriteria)}</structured_criteria>`, then any `correction` and "Emit only the IR object." The user description is HTML-encoded so a crafted `</user_description>` or a Custom HTML block delimiter cannot forge a tag or break out of the slot; criteria are validated against `structuredCriteriaSchema` (strict Zod with enum, hex-color regex, font-name regex) so they cannot smuggle markup.

Because the prefix is byte-stable, the cache stays warm across retries and across different users making similar requests — only the suffix varies.

**Producer-side guards** (`src/orchestration/producer-guards.ts`). Before a candidate reaches the authoritative validator, `scanCandidate` walks the whole IR tree (to `MAX_SCAN_DEPTH = 12`, above the contract `MAX_DEPTH` of 10) for five hostile-output vectors — unsafe URL schemes, raw PHP tags, block-comment delimiters, unsafe `style.css` header sequences, and an invalid theme slug. These are a **cheap early-warning layer** that saves retry budget by catching a steered model early; they do not replace the validator. Matching is against the precise hostile token (whitespace is not globally collapsed, which would false-positive on benign prose).

### 3.3 The structured-output approach (the IR)

**Decision.** One source schema, two views.

- **Generation view** (`irGenerationSchema`, `src/orchestration/ir-views.ts`): envelope-tight (theme metadata, tokens, region shells with `kind`/`name` enums from the contract) but `content` is `z.array(z.unknown())`. This is what `generateObject` is called against. The flat `content` deliberately sidesteps Zod/AI-SDK recursive-schema bugs on the C-single path.
- **Validation view** (`IRValidated`): what `validateIR` (the Track-1 validator) returns after layers 1–3. Track 3 reimplements no validation — every candidate, repaired or not, must clear `validateIR` before it is returned or assembled.

**The IR schema itself** (`src/ir/schema.ts`) uses `z.strictObject` throughout (`additionalProperties: false`), with structural bounds exported as constants (`MAX_INNER_BLOCKS = 32`, `MAX_TEXT_LENGTH = 2000`, `MAX_DEPTH = 10`, `MAX_TOTAL_NODES = 2000`, `THEME_SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/`). The recursive node is a strict-armed `z.union([blockNodeSchema, patternRefSchema])` with disjoint required keys (`block` vs `pattern`), so an object carrying both matches neither arm and is rejected deterministically. `blockNodeSchema.block` is `z.enum(ALLOWLIST)` — not a free string, and `core/html` is absent. The one intentionally lenient field is `attributes` (an open `z.record(z.string(), z.unknown())`), because rich-text `content` values legitimately contain inline HTML; per-block attribute schemas are applied at validator layer 2a, not in the IR schema.

**The validator pipeline** (`src/validator/index.ts`) is fixed-order and fail-closed — each layer short-circuits on first failure, returning `{ ok: true; value } | { ok: false; errors }`, never throwing on untrusted input and never silently passing:

| Layer | File / function | What it enforces |
|---|---|---|
| **1 — Schema** | `layer1-schema.ts` `layer1` | Plain-object check; an iterative (non-recursive) pre-walk for depth/node-count bounds *before* any Zod parse; `irValidatorSchema.safeParse` (lenient `block: z.string().min(1)` but still `additionalProperties: false`). A `core/html` block name passes layer 1 by design and is caught at 2a. |
| **2a — Block-tree, per node** | `layer2-blocktree.ts` `layer2a` | `isAllowedBlock`; per-block attribute schema (`ATTRIBUTE_UNKNOWN`/`_OUT_OF_RANGE`/`_UNSAFE_URL`); `core/query` config; containment against `GRAMMAR`; pattern existence and param-kind match. |
| **2b — Post-composition** | `layer2-blocktree.ts` `layer2b` | Region uniqueness; single-`h1` rule; dangling token references against IR + WP core presets. (Emits `REGION_NOT_UNIQUE`, `MULTIPLE_H1`, `DANGLING_TOKEN_REFERENCE`; the reserved `HEADING_OUTLINE` code has no producer here — see CP-8.) |
| **3 — theme.json** | `layer3-themejson.ts` `layer3` | Hex-only colors and a `DANGEROUS_CSS` rejection list for token values; compile to `ThemeJson`; AJV against the vendored draft-07 schema; the v3 core-slug-reuse guard. |
| **4 — Assembled artifact** | `layer4-scan.ts` `scanAssembledArtifact` | Byte scan + re-parse of every assembled `.html`/`.php` file (see §6.2). Imported directly by the assembler, not wired through `validateIR`. |

The `theme.json` compile path (`src/themejson/compile.ts`) carries one non-obvious correctness responsibility: WordPress v3 silently drops a custom preset that reuses a core slug unless the matching default is explicitly disabled. The compiler detects reuse via `CORE_COLOR_SLUGS`/`CORE_FONT_SIZE_SLUGS`/`CORE_SPACING_SLUGS` and conditionally emits `defaultPalette: false` / `defaultFontSizes: false` / `defaultSpacingSizes: false`; layer 3 repeats the check (`reuseWithoutFlag`) against the compiled output. This is an assembly-time responsibility, not a validation-time one — accepted as a known risk in §5.

---

## 4. Alternatives considered & rejected

### 4.1 Output format (the core decision)

| Candidate | Verdict | Reason |
|---|---|---|
| **Native WordPress block markup + `theme.json` v3** | **Chosen** | Installs on any vanilla WordPress 5.9+ with no plugins; satisfies the FSE-block-theme product goal directly; the only format the entire constraint system can validate. |
| The Custom HTML block (`wp:html`) | **Rejected — disqualifying** | The documented naive-LLM failure mode (Bossenger case study): models default to wrapping everything in `core/html`, the "escape hatch" for arbitrary raw HTML. Technically installs but violates the brief's single most-emphasized constraint. The architecture makes it impossible at five layers (§6.2). |
| Raw HTML / PHP classic-theme templates (`page.php`, `functions.php`) | **Rejected** | Categorically wrong: classic themes are not FSE block themes, cannot be driven by `theme.json`, and invite arbitrary PHP execution surfaces. The brief explicitly targets FSE block themes. |
| Page-builder JSON (Elementor, Divi, Beaver Builder) | **Rejected** | Not native block markup; would require the corresponding plugin, violating the standalone/vanilla-WP constraint. Native markup needs no plugin. |

### 4.2 Generation reliability mechanism (Q7)

| Candidate | Verdict | Reason |
|---|---|---|
| **Option C — envelope-strict / tree-best-effort + post-hoc validation** | **Chosen** | Provider-independent; the validator (not the provider) guarantees correctness, so the mechanism survives a provider swap. C-single is the floor that is correct regardless of how the depth measurement lands. |
| Option A — CFG constrained decoding (llguidance/XGrammar) | **Rejected for MVP** | Full-grammar constrained decoding (incl. recursion) exists, but hosted providers expose only a JSON-Schema subset to API callers — there is no `response_format: {type:"grammar"}` endpoint as of 2026-05. Would require self-hosting (vLLM + XGrammar on open weights), conflicting with the hosted-provider swap expectation and adding ops weight. |
| Option B — flattened adjacency-list IR | **Deferred (contingent contract-change request)** | Flattening the tree into a node array with parent IDs fits hosted strict-mode depth caps, but it is an IR-shape change that forces Track 3 (coding against the recursive schema) into a rewrite. Fires only if neither Option C arm clears the §3.6 latency budget **and** Option B beats the better C arm by a margin justifying the rework. |

### 4.3 IR shape (Q1)

| Candidate | Verdict | Reason |
|---|---|---|
| **Hybrid: `patternRef` default + constrained free-tree gap-filler** | **Chosen** | Safety of curated patterns by default; graceful degradation for uncovered regions. |
| Free block-tree authoring (Option A) | **Rejected as primary** | Reintroduces the hallucination surface (`core/missing`, `wp:html` escapes). `STRATEGY.md` explicitly rejects freeform AI layout authoring; the free-tree survives only as a governed gap-filler. |
| Pure pattern-composition (no free-tree) | **Rejected** | Maximally safe but caps the MVP to the seed library's exact coverage and makes uncovered regions fail loudly. Retained only as the **final-attempt fallback** (a prompt-suffix toggle, not a schema change). |

### 4.4 Validation authority (Q3)

- **Rejected as primary — registry-backed `@wordpress/blocks` (`getBlockType`/`validateBlock`):** assumes a hydrated JS runtime, provides no containment checks, couples Track 1 to one language.
- **Retained as backstop — WordPress Playground `parse_blocks()` / `WP_Block_Type_Registry`:** the authoritative outer gate after assembly, catching anything the standalone grammar misses.

### 4.5 Provider / SDK, package manager, schema source

- **Direct Anthropic/OpenAI SDK (no Vercel AI SDK):** rejected — would require building the mandated swap abstraction by hand; the SDK gives it free (§3.1).
- **pnpm / bun as default:** rejected — both are faster, but the brief demands friction-free `npm install && npm test`; "install X first" is exactly the friction warned against. See ADR-0001.
- **`theme.json` schema: hand-authored fragment** — rejected (drifts); **generate from `theme-i18n.json`** — rejected (category error: an i18n key map, not a structural schema). **Chosen:** vendor the upstream draft-07 schema, pinned by commit + SHA-256, validated with AJV (CP-6).

---

## 5. Trade-offs consciously accepted

- **Supported-block allowlist is a closed set of 32 names** (`src/blocks/allowlist.ts`, mirrored in `contract/allowlist.json`, drift-guarded in `allowlist.test.ts`). Expansion is a deliberate PR, never a runtime fallback. Explicitly excluded forever: `core/html` (disqualifying), `core/shortcode` (arbitrary PHP surface), `core/freeform` (classic-editor raw HTML), and every third-party namespace (not guaranteed present in vanilla WP). **`core/media-text`/`core/gallery` are not pre-admitted** — they are deferred until Track 2 builds the photographer-portfolio patterns that use them, at which point they are admitted as a byproduct. An allowlisted-but-unused block is exactly the free-tree surface the model can emit into where no pattern validates the composition.
- **STORE over DEFLATE** for the zip (`src/assembler/zip.ts`). Trades archive size for byte-level reproducibility across environments — DEFLATE output varies by zlib version/platform; STORE has no zlib dependency. This is what makes the committed golden `.zip` test (`src/assembler/index.test.ts`) able to assert exact bytes.
- **npm over pnpm/bun** — reviewer-friendliness over local dev speed (see §4.5 and ADR-0001).
- **C-single floor over C-decomposed for now.** C-single's strict envelope is "near-decorative" for first-try success on the tree (the easy part is strictly validated; the hard part is not). The pattern-reference bias keeps output shallow enough that decomposition's ~10pp benefit may not be needed; C-decomposed is the measured escalation arm, not a default (CP-13, §8).
- **Single pinned WP 6.6 target** for byte-exact `save()` parity. Users on other versions get best-effort, with honest `style.css` headers (`Requires at least: 6.6`, `Tested up to: 6.6`, `Requires PHP: 8.2`). A version matrix in CI would multiply CI time and could force the serializer toward an invalidation-free markup subset; escalation is gated on real cross-version invalidation data.
- **`theme.json` v3 origin-key gotcha accepted as a known assembly-time responsibility** (§3.3): the compiler must emit the `default*` disable flags whenever tokens reuse a core slug, or WordPress silently drops the preset.
- **MVP scope boundaries:** no in-product iteration loop (would force conversation state into Track 3 and a chat surface into Track 4), no in-app live preview (would force a WordPress-rendering layer / deployed sandbox). Both are "What I'd Do Next" items (§8).
- **Track 2 pattern library at the seed size, not the 8–12 needed for genuine distinctiveness** — the deliberate consequence of the CP-19 effort-allocation decision.

---

## 6. Security considerations

### 6.1 User-provided strings in theme data — per-output-context defenses

User and AI-emitted strings flow into multiple distinct output contexts, each needing a *different* escape contract. Treating "we escape text" as a blanket defense is explicitly wrong: the safe transform for an HTML body (entity-encode) does nothing for a `javascript:` URL or a PHP context. The assembler applies the correct transform per context at write time. Defenses live in `src/assembler/escaping.ts` (origin §6.4):

| Output context | Vector if unescaped | Guard |
|---|---|---|
| Block `text` → HTML element content | `<script>` / element injection | HTML-entity encode |
| URL-valued attributes | `javascript:` / `data:` → stored XSS | Safe-scheme allowlist (`http`/`https`/`mailto`/`tel`); reject all others |
| `title`/`author`/`description` → `style.css` comment header | `*/` closes the comment → CSS/PHP injection; CR/LF forges a second header line | `sanitizeHeaderValue` strips `*/` and C0 controls + DEL (incl. CR/LF). Strip-not-reject, so a benign incidental newline still yields a valid theme |
| Token values → `theme.json` → CSS | `#f00; } body{…}` injects verbatim CSS | Per-category value validation: hex-color regex, size charset + `DANGEROUS_CSS` rejection (layer 3) |
| Strings → `patterns/*.php` header/body | `?> <?php …` → PHP-RCE (pattern files are `require`d by WordPress) | **No user/AI data is ever interpolated as PHP code.** `buildPatternPhp` interpolates only a sanitized title and a charset-validated slug; the markup body has already passed the PHP-delimiter rejection in `patterns.ts` |
| Slug → archive entry path | `../../wp-config` → zip-slip / traversal | `assertSafeSlug` (reuses the IR's own `THEME_SLUG_RE`) + `assertSafeRelPath` (rejects empty/absolute/`..`/backslash) on every composed path via `buildEntryPath` |
| `patternRef.params` text → blob substitution | `-->` / a Custom HTML block delimiter closes the attribute comment | **Structured substitution, not string-replace.** Per-kind preparation (`text`→entity-encoded, `tokenRef`→regex-validated slug, `url`→safe-scheme, `scalar`→enum/range), then `assertNoForbiddenSequences` on every value, then Gutenberg's own `wpSerialize` encoding, then a final `containsRawHtmlDelimiter` check on the output |

The **PHP-RCE vector is the highest-severity finding** (pattern files execute on activation) and is closed structurally by the no-interpolation rule. The `FORBIDDEN_NORMALIZED` set checked on every param value and blob is `<?php`, `<?=`, `<?`, `?>`, `<!--wp:` (any block-delimiter open), and bare `wp:html`.

### 6.2 The disqualifying `wp:html` constraint — enforced in depth

The constraint is enforced at **five independent points**, each catching a distinct failure mode. It is never weakenable.

| Point | File | Mechanism |
|---|---|---|
| **1. Allowlist excludes `core/html`** | `src/blocks/allowlist.ts` | The block name is simply not in the closed 32-name set. |
| **2. Structurally unrepresentable in the IR** | `src/ir/schema.ts` | `blockNode.block = z.enum(ALLOWLIST)` and `additionalProperties: false` everywhere — the model cannot select `core/html`, nor invent a `rawHtml`/`customCss` key. The schema comment names this as making `wp:html` "structurally impossible to express rather than merely discouraged." |
| **3. Validator rejects it** | `src/validator/layer2-blocktree.ts` | When `!isAllowedBlock`, a case-folded `=== "core/html"` check tags the `BLOCK_NOT_ALLOWED` error with `invariant: "wp-html"` (vs `"hallucinated-block-name"`), catching any casing variant. |
| **4. Assembler byte scan + blob-integrity scan** | `src/validator/layer4-scan.ts`, `src/assembler/patterns.ts`, `src/assembler/pattern-manifest.ts` | A byte scan over every assembled `templates/*.html`, `parts/*.html`, `patterns/*.php` plus a pre-substitution blob scan and a SHA-256 blob-integrity manifest gate (run first in the pipeline). Layer-4 *also* re-parses each file: undelimited raw HTML surfaces as `core/missing`, which is in neither the allowlist nor the audited `ASSEMBLER_INTRODUCED` set (`core/page-list`, `core/pattern`), firing `UNRESOLVED_BLOCK_NAME`. |
| **5. Render-time assertion** | `src/harness/blueprint.ts` (assertion 2) | After install, `parse_blocks()` walks every template/part and asserts zero `core/html` nodes and zero undelimited (`null`-named, non-whitespace) chunks at render time. |

The shared detector (`src/assembler/wp-html-scan.ts`) is the single source of truth: `normalizeForScan` strips all whitespace and Unicode control/format characters then case-folds, collapsing evasions like `<!--  WP:HTML  -->` or zero-width-joiner splicing to the same needle; `RAW_HTML_DELIMITERS` targets the delimiter form (`<!--wp:html`, `<!--wp:core/html`) so prose that merely *mentions* the block does not false-positive. Both the pre-substitution scan in `patterns.ts` and the post-assembly scan in `layer4-scan.ts` import this one module — if they used separate logic, an evasion that slipped one could be missed by the other.

The critical distinction: a `text` field containing a Custom HTML block delimiter is **HTML-escaped to visible prose, not rejected** — a blog post *about* the Custom HTML block must still render. The layer-4 scan looks for raw, unescaped delimiters, so it does not false-positive on legitimately-escaped content.

### 6.3 Prompt injection

The user's free text is untrusted *data*, not instructions (§3.2). The trust boundary: it is wrapped in a named, delimited, HTML-encoded slot placed after the stable instruction prefix and never concatenated into the instruction segment; the instruction segment tells the model to treat the slot as a site description to satisfy, never as commands; structured criteria are a closed, typed sub-object, removing a secondary injection surface. This is defense-in-depth, not the only defense — a 480-scenario study found delimiter choice (XML vs Markdown) is dominated by model capability, and OWASP LLM01 states there is no fool-proof prevention. The architectural backstop is the validator: a steered model still cannot emit something that passes. Injection's residual lever is steering toward valid-looking but hostile *values* (e.g. `javascript:` URLs), each handled by the per-context escaping in §6.1. Injection can also burn the retry budget; the pattern catalog in the prompt is a published open-source artifact, so there is no system-prompt confidentiality exposure.

### 6.4 The server seam

`handleGenerateRequest` (`src/orchestration/limits.ts`) applies four guards in order before any provider call (CP-23):

1. **Rate limiter** — fixed-window 30 req/min/client (keyed on `X-Forwarded-For`/`X-Real-IP`), tracking map bounded at `maxKeys = 50,000` with expired-key sweep on overflow (a forged-key memory-DoS defense). Returns 429.
2. **Input-length cap** — `userDescription.length > 4000` → 400, *before* prompt construction, so no provider call is made for oversized input.
3. **Criteria validation** — `structuredCriteriaSchema.safeParse` at the boundary → 400 on hostile/oversized criteria, not a misclassified 502 from deep in generation.
4. **Spend guard** — bounded per-instance budget (1000 reservations), debited after validation and before the provider call; **fails closed** (never over-spends) and **refunds on a transient provider error** so forced transients cannot self-inflict a denial of service. Returns 503 when exhausted.

**Credential policy.** `ANTHROPIC_API_KEY` is read server-side only by the SDK inside `generateTheme`; it is never referenced in `limits.ts` or `route.ts` and never returned to the client. Any provider error that throws is passed through `sanitizeForLog` (the re-exported `sanitizeCause`) before `console.error`; the response body on a provider error is always the generic `{ error: "generation_failed" }` — no provider metadata, prompt, or model name. Telemetry (`src/orchestration/telemetry.ts`) is structured events only — never free-text logs of the prompt/response, never the key. The one path a credential could leak (a provider `.cause`) is sanitized by `sanitizeCause` at the `generateSingle` ingestion point *before* any metric is derived, not waiting for the server-boundary scrub. **No secrets reach the client bundle** — `app/page.tsx` is a Server Component (no `"use client"` directive; the file comment notes it is "intentionally bare until the input form lands in Track 4"), and the credential lives only in the route's server context.

---

## 7. Design exploration — how the system produces creative, non-generic designs

### 7.1 The thesis: compose curated, don't invent

Naive LLMs default to generic or hallucinated layouts. The resolution is to make the **source of visual taste the curated pattern library, not the model's imagination**. The model is not a layout author; it is a compositor and parameterizer. This is the creative corollary of "trust the parser."

### 7.2 The constrained-but-free generation model

The split in §3.2 is what makes this work: the model has genuine creative latitude (which patterns to compose, what token values express the aesthetic, section layout within the grammar) while everything that could break a theme is hard-constrained. Distinctiveness comes from three layers:

1. **Pattern composition choices** — which patterns are selected and combined across which regions.
2. **Token value assignments** — the model assigns concrete hex colors, font families, and spacing to a fixed token vocabulary (`base`, `contrast`, `primary`, `secondary`; `small`–`xxx-large` sizes; `30`–`80` spacing). A dark photographer theme gets a dark `base`, light `contrast`, a muted `secondary`; a minimalist landing page gets the opposite. Same vocabulary, distinct expressions. (The structured-criteria palette the user supplies carries `primary`, `secondary`, `background`, and `text` color fields, each a validated hex value, so the user can pin any of these directly and leave the rest to the model.)
3. **Optional content/media slots** — headline copy, subheadline, button labels, and (where the pattern permits) background-image choices.

### 7.3 The category-tagged token/slot + pattern-library system

The seed patterns cover the primary regions with sophisticated block usage: a `hero-cover` (a `core/cover` with an overlay, the single `h1`, and a paragraph — the static nested-subtree case), a `query-loop-list` (a `core/query` + `core/post-template` grid of post cards with featured image, title, date, excerpt, pagination — the dynamic Query Loop case), and a `site-footer` (multi-column with social links, site title, navigation — the site-data case). Each is hand-authored as valid native block markup, Playground-validated to confirm zero block-invalidation warnings, and split in `meta.json` into **parameterizable** surfaces and **locked** structure.

The **parameterizable/locked distinction is the key design insight** (from authoring the seed patterns): the model can change what it is allowed to change and cannot restructure what is locked, which prevents *generic* (unconstrained freeform) and *broken* (badly-nested) output simultaneously. Even a parameterizable knob can carry an inter-slot rule — the hero's `dimRatio` is parameterizable but conditional: 50–60 with a background image (legibility), and 100 with no image (or the solid color renders a washed translucent gray). This rule is documented in the pattern's parameterization rules, taught in the system prompt, and backstopped by validator layer 2b and the `slotRules` (`dimRatioImageDependency`) in `src/assembler/patterns.ts`.

### 7.4 Distinctiveness as a co-equal gate, and the breadth ceiling

To stop the orchestration layer from over-optimizing toward first-try validity at the cost of variety (collapsing toward a few near-identical compositions), Track 3 emits a diversity proxy (`diversity` telemetry: distinct `patternRef` slugs and distinct region compositions per N generations), which is a **co-equal secondary gate** in the §3.6 arm-selection rule — an arm that passes latency but collapses variety does not silently win. The distinctiveness *verdict* stays with Track 2's human panel rubric; the proxy only prevents silent degradation. The honest ceiling: the closed allowlist and pattern-library breadth bound how distinct two themes can be — at seed-library size, two prompts can produce visibly repetitive output. Only Track 2 breadth raises that ceiling (CP-19); Track 3 owns only the dial that trades validity against variety.

---

## 8. Current status & open decisions

This is the architectural-status snapshot: what is built, and which decisions remain open at the code level. The prioritized roadmap for this work — next-week priorities, production-readiness gaps, and the scaling discussion the brief asks for — is the standalone deliverable [`docs/what-id-do-next.md`](../what-id-do-next.md). The two are kept in sync; this section is the terse index, that document is the narrative.

**Built and tested:** the orchestration spine (`src/orchestration/`), the four-layer validator (`src/validator/`), the deterministic assembler and byte-reproducible zip (`src/assembler/`), and the Playground install/activate gate (`src/harness/`). The fast unit gate (`npm test`) mocks the provider and needs no API key; the slow gate (`npm run test:slow`) boots headless WASM WordPress. The companion deliverables — `STRATEGY.md`, `docs/phase-1-prd.md`, `docs/phase-2-prd.md`, and the frozen `contract/` interface — are committed and current.

**Open decisions and unwired seams (in priority order):**

1. **The HTTP route returns the validated IR as JSON, not a `.zip`.** `app/api/generate/route.ts` → `handleGenerateRequest` → `generateTheme` returns `{ status: "done", ir: <validated IR> }` (HTTP 200), `{ status: "failed", errors }` (HTTP 422), or `{ error: "generation_failed" }` (HTTP 502). The assembler, zip packaging, and install gate exist and are verified independently but are **not yet wired at this boundary.** Connecting `route → assembler → Response(zip blob)` is the top-priority functional next step before the app fulfills its core value proposition. (Documented next step — not in scope for this ADR.)

2. **No Track-4 input UI.** `app/page.tsx` is an intentional bare Server Component skeleton — no description field, no criteria form, no submit, no download trigger. The server seam (`POST /api/generate`) is ready; the front-end is unbuilt and unplanned.

3. **C-single vs. C-decomposed arm not locked (issue #23 / Q7, HITL).** Both arms exist (`src/orchestration/generate.ts`, `src/orchestration/decomposed.ts`); the experiment harness (`experiments/first-try-success/run.ts`) can compare them and emit a recommendation, but it requires a live `ANTHROPIC_API_KEY` and token spend. The arm is locked by flipping a single config point in `src/orchestration/index.ts`. **Default today: C-single** (the guaranteed-correct floor). The experiment's depth measurement may also open a "strict-per-region" fourth arm if observed per-region depth is consistently ≤5 levels — a post-MVP probe.

4. **WP-version coverage (Q9).** Single pinned WP 6.6 target accepted for the MVP; escalation to a CI version matrix is gated on real cross-version `save()`-invalidation data (the hand-authored pattern blobs are equally subject to that drift as the gap-filler serializer).

5. **Reserved-but-unwired error code.** `HEADING_OUTLINE` exists in the frozen 20-code enum with reprompt guidance but no producer (CP-8). Either wire a heading-outline check at layer 2b or formally retire the code at the next contract revision, so the contract and the implementation agree.
