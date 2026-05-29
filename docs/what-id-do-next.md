# What I'd Do Next

- **Status:** Living document
- **Date:** 2026-05-29
- **Author:** Jason Dijols
- **Related:** [ADR-0002 — AI Theme-Generation Architecture](adr/0002-ai-theme-generation-architecture.md) (§8 records the same open decisions as a terse architectural-status list; this document is the authoritative roadmap), [ADR-0001](adr/0001-application-stack.md), [`README.md`](../README.md), `STRATEGY.md`.

This is the brief's third required deliverable: priorities for another week, production-readiness gaps, and a scaling discussion. Every item is rooted in the realized code, not a speculative wishlist — each names the file it touches and the decision it closes.

---

## 1. The next week — close the MVP loop, in priority order

The correctness backbone and the AI orchestration are built and tested; what's missing is the last mile that turns them into a product a user can touch.

1. **Wire `route → assemble → download` (the headline gap).** `app/api/generate/route.ts` currently returns the validated IR as JSON; the assembler (`src/assembler/assembleThemeZip`), the byte-reproducible packager (`src/assembler/zip.ts`), and the install gate (`src/harness/`) all exist and are independently verified but are not connected at the HTTP boundary. The work: have the route call `assembleThemeZip(validatedIR)` and return the bytes as a `Blob` with `Content-Disposition: attachment; filename="<slug>.zip"` and `Content-Type: application/zip`, with the existing 422/502/429/503 paths unchanged. **Until this lands the app does not deliver its core value** — it is the single highest-priority item. *(~½ day.)*
2. **Build the Track-4 input UI.** `app/page.tsx` is a bare Server Component skeleton. The work: a natural-language description field + a structured-criteria form (palette, typography), client-side submit to `POST /api/generate`, the §5.2 structured-error rendering (map the validator's `{ code, layer, path, hint }` list to legible field-level messages), and a download trigger for the returned `.zip`. The server seam is ready; this is purely additive front end. *(~1–2 days for a clean, non-generic single screen.)*
3. **Lock the generation arm (issue #23 / Q7, HITL).** Run `experiments/first-try-success/run.ts` against the real provider (needs `ANTHROPIC_API_KEY` + token spend), read the first-try-success + distinctiveness + latency recommendation, and flip the one config point in `src/orchestration/index.ts` (default stays **C-single**, the guaranteed-correct floor, if the data doesn't justify C-decomposed). This is a measurement + a one-line change, not new code. *(~½ day once the key is in hand.)*
4. **Grow the pattern library (Track 2).** The seed is three patterns (`hero-cover`, `query-loop-list`, `site-footer`); distinctiveness is bounded by library breadth (ADR-0002 §7.4). `STRATEGY.md` names this the highest-leverage-per-hour track. Target 8–12 patterns across archetypes (photographer portfolio, dark-mode blog, minimalist landing), each Playground-validated with a `meta.json` parameterizable/locked split. This is what moves the "visually high-quality, non-generic themes" grade. *(Remainder of the week.)*

---

## 2. Production-readiness gaps

These are the things that are *fine for an MVP submission* but would block a real production deployment. They are called out honestly rather than hidden.

- **In-memory rate limiter and spend guard are per-instance.** `RateLimiter(30, 60_000)` and `SpendGuard(1000)` are module-scoped in `app/api/generate/route.ts` — "one set per server instance." Under any horizontal scaling (multiple serverless instances), the rate limit and the budget cap are enforced *per instance*, not globally, so the real limits are `N × the configured value`. Production needs a **shared store** (Vercel KV / Upstash Redis, or Edge Config for the budget) so the guards are global. This is the sharpest production gap and the first thing I'd fix after the MVP loop.
- **Transient provider errors propagate without backoff.** The retry loop (`src/orchestration/retry-loop.ts`) re-prompts on *validation* failure but lets timeout / rate-limit / network errors throw (by design — re-prompting can't fix a rate limit). Production wants bounded exponential backoff with jitter on `RetryError`/timeout at the provider seam, distinct from the validation re-prompt loop.
- **The "formal block validation pipeline" is split across two surfaces** (the brief's literal example of a production gap). The static validator (`src/validator/`, milliseconds) is the request-path authority; the Playground render gate (`src/harness/`, seconds) is a CI-only backstop. For production I'd either (a) run an **async post-generation Playground verification** before the `.zip` is delivered (or sampled), turning the CI gate into a delivery gate, and (b) stand up a **maintenance pipeline** that keeps the vendored `theme.json` schema and the `block.json`-derived attribute surface current with each WordPress release, since those are pinned snapshots today.
- **Observability.** Telemetry (`src/orchestration/telemetry.ts`) emits structured events but has no production sink. Real operation needs first-try-success rate, retry distribution, validator-failure-by-code, per-generation cost, and the distinctiveness proxy shipped to a dashboard — the same metrics the §3.6 experiment consumes, but live.
- **Reserved-but-unwired error code.** `HEADING_OUTLINE` is in the frozen 20-code enum with reprompt guidance but no producer (ADR-0002 CP-8). Either wire a heading-outline check at validator layer 2b or formally retire the code at the next contract revision, so the contract and implementation agree.
- **Single pinned WordPress target.** WP 6.6 / PHP 8.2 is the byte-parity target; other versions get best-effort with honest `style.css` headers. A production tool wants a CI version matrix gated on real cross-version `save()`-invalidation data (the hand-authored pattern blobs drift the same way the gap-filler serializer does).

---

## 3. Scaling discussion

- **Cost.** A single uncached Sonnet 4.5 generation is ≈ $0.08 (ADR-0002 §3.1). The byte-stable system prefix already carries a 5-minute ephemeral cache breakpoint (`src/orchestration/provider.ts`), so concurrent and repeat requests amortize the large, fixed instruction prefix — only the per-request suffix is uncached. As volume grows, the cache hit rate is the dominant cost lever; the warm-prefix design is what makes per-generation cost predictable.
- **Statelessness.** Tied to the production gap above: moving rate-limit and spend state to a shared store is the prerequisite for scaling horizontally without the guards degrading to per-instance.
- **The validation/verification split scales correctly by design.** The request path depends only on the in-process static validator (milliseconds, no external service), while the heavy real-WordPress Playground gate stays in CI / async. This separation means request throughput is not coupled to WASM boot time — worth preserving rather than "simplifying" into one path.
- **Pattern-library growth vs. the prompt budget.** Today the full pattern catalog is injected into the cacheable prefix. That scales to dozens of patterns on the cache, but there is a token ceiling. Past it, the move is **pattern *selection*** — retrieve only the patterns relevant to the request (a small embedding/keyword pass over `meta.json` descriptions) and inject those, rather than the whole catalog. This keeps the prefix bounded as the library becomes the product's main differentiator.
- **Provider throughput & circuit-breaking.** At scale the spend guard becomes a global circuit breaker (a shared budget that fails closed and refunds transients) and the provider's own rate limits become the binding constraint — another reason the limiter state must be shared, not per-instance.
- **Beyond the MVP.** Multi-user accounts, saved theme history, an in-product iteration loop, and live in-app preview are all explicitly out of MVP scope (ADR-0002 §5) but are the natural scaling path; each adds a stateful surface (a database, conversation state) the current stateless design deliberately avoids for now.

---

## 4. The unique challenges of dynamic file generation

Generating a *runnable software artifact* (not prose) imposes constraints most LLM apps never face. What this build got right, and what I'd harden next:

- **Byte-reproducibility across machines.** A generated `.zip` must be identical on a laptop and on CI for a golden-file test to mean anything. Solved with STORE (not DEFLATE), fixed UTC timestamps, NFC path + LF content normalization, and sorted entries (`src/assembler/zip.ts`), proven by a committed golden asserted byte-for-byte. **Next:** extend the golden corpus beyond the one `aurora-blog` archetype so every archetype is reproducibility-pinned.
- **Generation vs. validation as separate authorities.** "Trust the parser, not the prompt" (ADR-0002 CP-4) is the load-bearing idea: the model proposes, a deterministic validator enforces, so correctness survives a provider swap. **Next:** unify the four static layers + the Playground gate into one documented "validation pipeline" artifact (the brief's production-readiness example), so the request-path and CI gates read as one named pipeline rather than two.
- **Per-output-context escaping.** The same untrusted string is dangerous differently in an HTML body, a `style.css` header, a PHP pattern file, a URL, and a zip entry path — one escape does not cover all (ADR-0002 §6.1). The assembler applies the correct transform per context at write time; the highest-severity vector (PHP-RCE in `require`d pattern files) is closed structurally by never interpolating data as code.
- **Serialization parity.** Reimplementing each block's `save()` is a perpetual drift hazard, so serialization is delegated to `@wordpress/blocks` `serialize()` as the parity oracle, exact-pinned (ADR-0002 CP-7). **Next:** the cross-version `save()`-parity data that gates the WP version matrix above.
- **The disqualifying constraint.** Zero Custom HTML block (`wp:html`), enforced in depth across five independent points with a single shared detector so the layers can't drift (ADR-0002 §6.2). This is the clearest example of why dynamic file generation needs defense-in-depth rather than a single prompt instruction: a steered model, a mutated pattern blob, and a serializer bug are *different* failure modes, each caught by a different layer.
