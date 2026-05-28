# ADR-0001 — Application Stack

- **Status:** Accepted
- **Date:** 2026-05-27
- **Deciders:** Jason Dijols
- **Related:** [`STRATEGY.md`](../../STRATEGY.md), [`docs/phase-1-prd.md`](../phase-1-prd.md)

## Context

We are building an AI-powered WordPress Block Theme generator (see `STRATEGY.md`). The app must:

- Run server-side AI provider calls (secret keys must never reach the client)
- Validate AI output against schemas and assemble a `.zip` deterministically
- Present a natural-language + structured-criteria input UI to the primary persona (solo makers)
- Keep the AI provider **swappable** (brief requirement)
- Install and run with **zero setup friction** for an Automattic reviewer (`npm test` must just work)
- Deploy to Vercel (`<name>.vercel.app`)

The app stack is our choice; only the *output* is WordPress-specific (JSON/PHP/HTML). This ADR records the foundational stack decision. Component-level decisions (IR shape, validator authority, install-harness fidelity) are deferred to later ADRs as `docs/phase-1-prd.md`'s open questions resolve.

## Decision

| Concern | Choice |
|---|---|
| Runtime / language | **Node 20+ / TypeScript** (strict mode) |
| App framework | **Next.js (App Router)** |
| AI integration | **Vercel AI SDK**, default provider **Anthropic Claude**, structured output via `generateObject` + Zod |
| IR validation | **Zod** (typed intermediate representation; same schema powers `generateObject`) |
| `theme.json` validation | **AJV** (consumes WordPress's published JSON Schema — Draft-07 per PRD research) |
| Unit + integration tests | **Vitest** |
| End-to-end tests | **Playwright** (the five critical-path flows) |
| `.zip` packaging | **JSZip** |
| Install/activate harness | **WordPress Playground** (wasm; no Docker, CI-friendly, honors the standalone constraint) |
| Package manager | **npm** |

## Rationale

- **Node/TypeScript** lets us vendor the canonical `@wordpress/*` packages (e.g. `block-serialization-default-parser`) for authoritative block parsing if PRD Q3 lands that way, and keeps one language across the whole pipeline. Strict mode enforces the typed-contract discipline the strategy depends on.
- **Next.js App Router** keeps the AI key server-side cleanly (server actions / route handlers), gives us the input-form UI and the download endpoint in one repo and one Vercel deploy. No separate API surface to wire up or secure.
- **Vercel AI SDK** satisfies the brief's swappability requirement *out of the box* — `generateObject({ schema })` returns schema-validated structured output (directly serving "trust the parser" + the first-try-success metric), and the provider is a one-line swap between Anthropic, OpenAI, and local models. Defaulting to Claude for strong tool-use/structured-output behavior; the swap cost is near-zero, so the choice is low-risk and reversible.
- **Zod + AJV split**: Zod validates our own IR (and is the schema `generateObject` consumes); AJV validates the assembled `theme.json` against WordPress's *external, published* Draft-07 schema. Two validators because they validate two different contracts against two different schema sources.
- **Vitest + Playwright** cover the brief's unit/integration requirement and Oracle #5 (behavioral e2e) respectively.
- **WordPress Playground** is the install/activate smoke-test harness (PRD Q5) — runs in CI without Docker or credentials, which keeps the "standalone, no external services" constraint intact.
- **npm** because the brief explicitly demands `npm test` run cleanly with no setup friction. A reviewer expects `npm install && npm test`. Faster managers (pnpm, bun) add an "install X first" step that reads as exactly the friction the brief warns against.

## Alternatives considered

- **App framework — Vite SPA + serverless API:** lighter frontend, but splits the app into two mental models and a hand-wired API layer. Rejected: more moving parts for no MVP benefit. **Minimal Hono/Express + static form:** maximal pipeline focus, but weak UX story against the "raises the bar" criteria. Held as a fallback if UI time runs short.
- **AI integration — Direct Anthropic / OpenAI SDK:** maximum per-provider control, but forces us to build the swappability abstraction the brief requires anyway. Rejected: reinvents what the Vercel AI SDK gives free. **Vercel AI SDK default OpenAI:** viable (strict JSON-schema outputs are very reliable); kept as the first swap target if Claude underperforms on first-try success during Phase 2 tuning.
- **Package manager — pnpm / bun:** faster, and bun is already installed locally. Rejected as the default for a *submission* because reviewer friction outweighs our dev-speed gain. We can use bun locally and still ship an npm-compatible `package.json`.

## Consequences

**Accepted tradeoffs:**
- npm installs are slower than pnpm/bun — we eat that for reviewer-friendliness.
- Vercel AI SDK adds a dependency layer between us and the raw provider APIs — we lose a little provider-specific control in exchange for swappability we'd have to build anyway.
- Next.js is heavier than a minimal API for what is, at MVP, a one-screen app — justified by the clean server-side secret handling and the single-deploy story.

**Deferred to later ADRs** (tracked as open questions in `docs/phase-1-prd.md`):
- IR shape: free block-tree vs. pattern-composition vs. hybrid (PRD Q1)
- Block-validation authority: vendored `@wordpress/blocks` vs. standalone allowlist vs. Playground-PHP (PRD Q3)
- Specific default model within Anthropic (Opus vs. Sonnet) — a Phase 2 cost/quality tuning decision, not a stack decision
