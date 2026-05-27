---
name: WordPress Block Theme Generator
last_updated: 2026-05-27
---

# WordPress Block Theme Generator Strategy

## Target problem

Someone with a clear aesthetic vision for a new WordPress site is stuck between three bad options: fight a generic Astra/Kadence theme in the Full Site Editor into something distinctive, hire a designer-developer, or hand-author `theme.json` + templates + patterns themselves. The AI-era shortcut — "ask ChatGPT to write me a block theme" — fails quietly: naive LLMs smuggle everything into `<!-- wp:html -->` (the disqualifying escape hatch), hallucinate block names, or emit invalid `theme.json`. Nothing reliably translates a description into a structurally-valid, native-block, installable `.zip` without an expert in the loop.

## Our approach

Treat the AI's output as untrusted, schema-validated input to a deterministic theme-assembly pipeline — the parser, not the prompt, is the gate. As a corollary, source distinctive visual quality from a curated library of designer-grade block patterns the AI composes and parameterizes — the pattern library, not the model's imagination, is the source of taste.

**Contractual invariant (not a metric):** 100% catch rate on `<!-- wp:html -->`, hallucinated block names, and invalid `theme.json`. Below 100% is a release-blocking bug, not a degraded number.

## Who it's for

**Primary:** Solo makers (indie hackers, freelance designer-devs, creators) standing up a small-to-medium WordPress site for themselves or a single client. Has taste, comfortable installing a `.zip` and iterating in the Full Site Editor, but won't hand-author `theme.json` or settle for fighting a generic theme into shape. They're hiring this product to *skip the "fight a generic theme into shape" phase entirely* — given a vision, produce a structurally-sound, visually-distinctive Block Theme they can install today and iterate on in FSE.

*Secondary, not primary:* WP agencies (want CLI + override hooks — dilutes the natural-language UX); non-technical content creators (real market, wrong product stage — no preview/deploy yet); Figma-first designers (wrong tool — they want pixel deliverables, not `theme.json`).

## Key metrics

**Leading (moves daily/weekly — signals pipeline health):**

- **First-try generation success rate** — % of natural-language prompts whose first AI output passes schema validation end-to-end and produces a downloadable `.zip` with zero retries. Tells us how well prompt and schema are co-tuned.
- **Validator escape-attempt trend** — count, per N generations, of times the AI *tried* to emit `wp:html` / a hallucinated block / invalid `theme.json`. The catch rate is a 100% invariant (above); this is the prompt-engineering signal, separate from whether the parser is doing its job.
- **Median wall-clock time, prompt-submit → downloadable .zip** — user-facing speed for the JTBD. Provider-latency share tracked separately as exogenous.

**Lagging (moves weekly — signals strategy is winning):**

- **Vanilla-WordPress install + activate cleanliness rate** — % of generated themes that install + activate cleanly with zero warnings or errors. Target: 100%. CI gate + the README/ADR "this actually works" evidence.
- **Distinctiveness** — small rotating human panel scores N themes on a 1–5 "would I actually ship this?" scale; pattern-diversity counts distinct compositions across N themes. Rubric defined in ADR.

*Brief criteria deliberately not metricized:* "tests pass cleanly," "valid runnable theme," "robust validation," "zero `wp:html`" are CI gates / contract invariants, not feedback signals. Each lives in CI, not on the metrics dashboard.

## Tracks

### Schema, validator, and deterministic assembler — *correctness backbone*

JSON Schema for `theme.json`; block-name allowlist + block-tree grammar; the parser that turns LLM output into a typed intermediate representation; the deterministic assembler that turns validated IR into theme files + `.zip`; the vanilla-WP install/activate test harness; the structured error format the orchestrator and UI consume.

_Why it serves the approach:_ The contractual gate. "Trust the parser, not the prompt" lives or dies here, and so does the 100% catch-rate invariant.

### Curated pattern library + design tokens — *taste backbone*

Hand-curated pattern set (heroes, navs, post lists, footers, content sections); parameterization surface (which design tokens each pattern accepts — color, typography, spacing, density); composition rules (which patterns are valid in which template regions); design-token vocabulary the AI selects from when generating `theme.json`; the panel rubric + distinctiveness methodology that gives the Distinctiveness metric teeth.

_Why it serves the approach:_ The "compose curated, don't invent" corollary lives here. Highest-leverage-per-hour track — a great library makes the other three tracks look better simultaneously; a thin library makes them all look generic.

### AI orchestration — *model-facing surface*

Prompt construction (per-layer vs monolithic); structured-output mechanism (function-calling / JSON mode / constrained decoding); model selection + provider abstraction (the brief's swappability requirement); retry budget + re-prompt-on-validator-failure logic; the prompt + schema co-tuning loop; cost / latency budget per generation.

_Why it serves the approach:_ The layer that turns user intent into structured output the schema can validate, and that recovers when validation fails. Owns three of the five metrics directly.

### Human surface — *JTBD delivery*

Input form (natural-language vision + structured criteria for color, typography, site type); validator-error display (legible to the persona, not raw JSON Schema violations); download flow; eventual preview + iteration loop (out of MVP scope but homed here when they arrive).

_Why it serves the approach:_ The validator-rejects-loudly invariant only delivers value to the persona if rejections are legible. Without this track, the strategy-to-user surface has no owner. Light track, real track.

## Not working on

- **In-product iteration loop** (refine the theme through follow-up prompts) — bonus criterion in the brief. Pulling forward forces conversation state in Track 3, a chat-like surface in Track 4, and a new convergence metric. Wrong trade for the 5-day MVP. Documented in "What I'd Do Next" and ADR.
- **In-app live preview** — bonus. Would force a WP-rendering layer in Track 4 and likely a deployed sandbox WP. Out of MVP.
- **Freeform AI layout authoring** — explicitly the alternative strategy rejected in *Our approach*. If the model "needs" to invent a layout the curated library doesn't cover, the right fix is library expansion (Track 2), not loosening the validator (Track 1).
- **Agency-style CLI + override hooks** — would dilute the natural-language UX and serve the secondary persona at the cost of the primary.
- **Standalone "advanced-block-usage" metric** — captured indirectly by Distinctiveness pattern-diversity. A standalone metric creates Goodhart pressure to sprinkle Query Loops to hit the number.
