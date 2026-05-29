# Architectural Decision Records — Index

This directory holds the project's Architectural Decision Records (ADRs): each numbered file records **one decision** with its context, rationale, alternatives, and consequences. Together they are the decision history of the build.

This index is the **single digestible entry point**. It is not itself an ADR — it is a map: a one-line summary of every record, plus a matrix that answers the brief's five required ADR questions with a direct link to the section that answers each. Start here, then follow the link into the detail you need.

> For the project as a whole, start at the [repository README](../../README.md). The brief's other graded narratives live beside this directory: [`docs/what-id-do-next.md`](../what-id-do-next.md) (priorities, production gaps, scaling), the phase PRDs ([phase 1](../phase-1-prd.md), [phase 2](../phase-2-prd.md)), `STRATEGY.md`, and the frozen interface under [`contract/`](../../contract/).

---

## The records

| ADR | Decision | Status |
|---|---|---|
| [0001 — Application Stack](0001-application-stack.md) | The foundational stack: Node/TypeScript (strict), Next.js App Router, Vercel AI SDK + Zod, AJV, Vitest, JSZip, WordPress Playground, npm. Includes a 2026-05-29 execution note reconciling two choices superseded during the build (Playwright → Playground; the model tier resolved to `claude-sonnet-4-5`). | Accepted |
| [0002 — AI Theme-Generation Architecture](0002-ai-theme-generation-architecture.md) | The consolidated architecture record: a checkpoint-by-checkpoint decision timeline (CP-1…CP-23) plus deep-dives on the model/provider, the reliable-yet-creative IR strategy, alternatives, trade-offs, security, and design exploration. Builds on 0001. | Accepted |

_Future ADRs (Track-4 UI, the `route → assemble → download` wiring, the locked generation arm) append here — one row each, and the matrix below is updated to point at the new section if it answers one of the brief's questions._

---

## Brief-requirements matrix

The brief asks the ADR to cover five things. Each maps to a specific section — follow the link for the full treatment.

| The brief asks for… | Answered in | In short |
|---|---|---|
| **Key technical decisions** — e.g. how the AI is guided to be reliable yet creative; why a specific AI model | ADR-0002 [§3 Key technical decisions](0002-ai-theme-generation-architecture.md#3-key-technical-decisions) (§3.1 model/provider, §3.2 reliable-yet-creative, §3.3 the IR); stack in [ADR-0001](0001-application-stack.md) | "Trust the parser, not the prompt": the prompt constrains, a deterministic validator + assembler enforce. Default model `claude-sonnet-4-5` behind the swappable Vercel AI SDK seam. Hard-constrain what breaks a theme; leave composition and token values free. |
| **Alternatives considered** and why rejected — e.g. different output formats | ADR-0002 [§4 Alternatives considered & rejected](0002-ai-theme-generation-architecture.md#4-alternatives-considered--rejected) (§4.1 output format is the core decision) | Native block markup + `theme.json` v3 chosen over the Custom HTML block (disqualifying), raw HTML/PHP classic themes (not FSE), and page-builder JSON (needs a plugin). Plus rejected provider/IR-shape/generation-mechanism options. |
| **Trade-offs consciously accepted** — e.g. scope limits on supported blocks | ADR-0002 [§5 Trade-offs consciously accepted](0002-ai-theme-generation-architecture.md#5-trade-offs-consciously-accepted) | Closed 32-block allowlist (no runtime fallback), STORE-over-DEFLATE for byte-reproducibility, npm over pnpm/bun, single pinned WP target, C-single floor over C-decomposed, MVP scope boundaries. |
| **Security considerations** — e.g. handling user-provided strings in theme data | ADR-0002 [§6 Security considerations](0002-ai-theme-generation-architecture.md#6-security-considerations) (§6.1 per-context escaping, §6.2 the `wp:html` defense in depth, §6.3 prompt injection, §6.4 the server seam) | Per-output-context escaping (HTML / CSS header / PHP / URL / zip path); the highest-severity PHP-RCE vector closed structurally; the disqualifying `wp:html` constraint enforced at five independent points; rate-limit / input-cap / spend-guard / credential-scrub at the server seam. |
| **Design exploration** — how the AI produces creative, unique designs | ADR-0002 [§7 Design exploration](0002-ai-theme-generation-architecture.md#7-design-exploration--how-the-system-produces-creative-non-generic-designs) | "Compose curated, don't invent": a validated pattern library is the source of taste; the model selects and parameterizes patterns and assigns token values within a fixed vocabulary. A distinctiveness proxy is a co-equal gate so optimizing for validity can't silently collapse variety. |

---

## Conventions

- **One decision per numbered file**, `NNNN-kebab-title.md`, MADR-flavored (Status / Date / Deciders / Related → Context → Decision → Rationale → Alternatives → Consequences).
- **Supersede, don't rewrite.** When a later decision overturns an earlier one, add a dated note to the old ADR and mark its status `Superseded by ADR-NNNN` — keep the history legible rather than editing it away (see ADR-0001's execution note for the pattern).
- **When you add or change an ADR, update this index** — the row in *The records* and, if it answers a brief question, the *Brief-requirements matrix*. The index is only useful while it is current.
