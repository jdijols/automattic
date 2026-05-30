# WordPress Block Theme Generator

> **About the name.** The product is named **Automattic** — a deliberate homage to [Automattic](https://automattic.com) (parent of WordPress.com), the Partner evaluating this Gauntlet AI Partner Project — Challenger submission. This is a portfolio piece by Jason Dijols, **not** an Automattic product nor an official Automattic project; the name is a tribute, adopted as a conscious accepted tradeoff (see [ADR-0002](docs/adr/0002-ai-theme-generation-architecture.md) CP-24 and the Naming section in `CLAUDE.md`). The npm package keeps the descriptive id `wp-block-theme-generator`.

An AI-powered generator that turns a natural-language site description plus structured criteria (color palette, typography) into a complete, valid **WordPress Full Site Editing (FSE) Block Theme**, packaged as an installable `.zip`.

The headline quality bar is a **hard guarantee: the generated theme never uses the Custom HTML block (`wp:html`)** for any structural or visual element — only native WordPress block syntax. This is the single most-emphasized constraint in the brief. It is enforced in depth: the dangerous shape is structurally unrepresentable in a valid IR (the allowlist enum has no `core/html`), it is rejected by the layered validator, it is byte-scanned out of the assembled artifact, and it is asserted absent at render time inside real WordPress. It is not a setting that can be weakened.

---

## Status

The correctness backbone is built and tested end-to-end; the HTTP delivery surface and the input UI are not yet wired. Be precise about what works today:

| Stage | State |
|---|---|
| AI orchestration → validated IR | **Works.** Swappable provider seam, prompt construction with injection-hardened trust boundary, bounded retry loop, telemetry. |
| Layered validator (layers 1–4, fail-closed) | **Works, tested.** Adversarial fixture corpus + property tests. |
| Deterministic assembler → byte-reproducible `.zip` | **Works, tested.** Asserted byte-for-byte against a committed golden zip (`src/assembler/golden/aurora-blog.zip`). |
| WordPress Playground install/activate gate | **Works, tested.** Headless WASM WordPress (WP 6.6 / PHP 8.2), four runtime assertions. |
| `POST /api/generate` HTTP route | **Partial — returns the validated IR as JSON, not a `.zip`.** The route runs the orchestration spine (throttle → input cap → criteria validation → spend guard → generate) and returns `{ status: "done", ir: {...} }`. It does **not** yet call the assembler or stream a downloadable archive. |
| Front-end input form | **Not built.** `app/page.tsx` is an intentionally bare skeleton. The server seam exists; the form does not (Track 4 is unbuilt). |

In short: the **validate → assemble → zip → install-verified** pipeline exists and is covered by tests, but the assembler is **not connected to the HTTP boundary** yet. Wiring `route → assembler → Response(zip)` is the top-priority next step. See [Known limitations](#known-limitations).

---

## Quickstart / local run

**Prerequisites:** Node **>= 20** (declared in `package.json` `engines`). The fast test suite needs **no API key** and **no other services**.

```bash
npm install        # clean install of dependencies
npm run dev        # start the Next.js dev server (App Router) at http://localhost:3000
```

`/` renders a placeholder page; the live server endpoint is `POST /api/generate` (returns validated IR JSON — see Status).

**Run the tests — zero setup, no key required:**

```bash
npm test           # fast unit + integration gate; completes in seconds
```

`npm test` **just works with no configuration and no `ANTHROPIC_API_KEY`.** The AI provider is mocked via dependency injection (a mock model object returns fixed output; the real `generateObject` parsing/repair path runs against it), so the fast gate makes **zero live provider calls**. This is deliberate — the brief prizes zero setup friction (`npm install && npm test`).

> **Contributor note (lockfile):** CI uses **npm 10** (bundled with Node 20). npm 11 (Node 22+) regenerates `package-lock.json` in a way that drops a nested `yaml` entry `npm ci` requires, which reds CI at install time. If you add, remove, or bump a dependency, regenerate the lockfile with `npx -y npm@10 install`, not a locally installed npm 11. The lockfile is `lockfileVersion: 3`.

---

## Environment variables

One variable, used only for **live** generation:

| Variable | Required? | Read where | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Only for live AI generation (the dev server / production route). **Not needed for `npm test`.** | Server-side only. The `@ai-sdk/anthropic` provider resolves it from the environment automatically inside `generateTheme`; it is **never** read via `process.env` in app code. It appears only in explanatory comments in `app/api/generate/route.ts` and `src/orchestration/limits.ts`. | Never logged, never returned to the client, never bundled into client code. Any provider error is credential-scrubbed by `sanitizeForLog` before it reaches a log line. |

To configure locally, copy the template and add your key:

```bash
cp .env.example .env.local   # then set ANTHROPIC_API_KEY=...
```

`.env.example` is the canonical reference (`ANTHROPIC_API_KEY=`).

**Provider swappability** is a brief requirement and is satisfied by design. The default provider is **Anthropic Claude Sonnet** behind the [Vercel AI SDK](https://sdk.vercel.ai). The exact model ID is **`claude-sonnet-4-5`**, set in one place — the `defaultModel()` helper in `src/orchestration/provider.ts`. Swapping to OpenAI or any other Vercel AI SDK provider is a one-line change to that helper; the schema, call policy, and result shape are untouched. (Note: ADR-0001 deliberately deferred the specific Claude tier to Phase 2, so the concrete model ID lives in `provider.ts`, not in the ADR.)

---

## Deploying to Vercel

The app is a standard Next.js App Router project and deploys to Vercel with no build configuration. `vercel.json` pins the framework and gives the generate route a `maxDuration` of 120s (the §7.3 latency budget is p95 ≤ 90s for generation; the rest is assembly headroom).

```bash
# One-time, from the repo root:
vercel link                                   # link to a Vercel project
vercel env add ANTHROPIC_API_KEY production   # paste your key (server-only — see below)
vercel env add ANTHROPIC_API_KEY preview      # (optional) for preview deployments
vercel deploy --prod                          # build + deploy
```

**Required environment variable — server-only.** `ANTHROPIC_API_KEY` is the only variable the app needs. It is read **server-side only**, by the AI provider inside the `/api/generate` route; it is never referenced in client code, never bundled, and never returned to the browser (do **not** prefix it with `NEXT_PUBLIC_`). `.env.example` is the canonical reference. CI builds and the fast test gate need **no** key (the provider is mocked).

**Runtime.** `/api/generate` is pinned to the Node runtime (`export const runtime = "nodejs"`) — never Edge — because the assembler bootstraps a jsdom DOM for `@wordpress/blocks` during zip assembly. `jsdom` is therefore a production `dependency` (not a devDependency), so it survives a production `--omit=dev` install. The assembler is imported **lazily** (a dynamic import inside the route's success branch), so the DOM bootstrap stays out of `next build`'s page-data collection and the build is clean.

> **Known deploy caveat (issue #49, cross-track).** `next build` succeeds and the route's IR/validation/error paths run anywhere. The **assembled-zip response**, however, depends on the assembler's DOM bootstrap (`src/assembler/dom-bootstrap.ts`), which currently assigns the read-only global `navigator` and so throws on **Node ≥ 21** at request time. Until the Track-2 `dom-bootstrap` fix (an `Object.defineProperty` guard) ships, the live `.zip` download is not guaranteed on Vercel's default Node runtime. That file is outside this delivery track's domain; the fix is tracked in issue #49. **Prep is complete; an actual production deploy is gated on that fix.**

---

## Architecture overview

The system is a fail-closed pipeline. The AI proposes; a deterministic validator and assembler enforce. A model that *tries* to emit a Custom HTML block cannot succeed — the dangerous shape is structurally unrepresentable at the IR level (the block allowlist enum has no `core/html`), it is rejected by the validator, and it is byte-scanned out of the assembled artifact.

```
  user description + structured criteria
              │
              ▼
  ┌───────────────────────────┐   AI orchestration (src/orchestration/)
  │ prompt construction        │   • untrusted user text is HTML-encoded into a
  │ + swappable provider seam  │     delimited <user_description> slot, never the
  │ (Vercel AI SDK, default    │     instruction segment
  │  Anthropic claude-sonnet-  │   • cacheable byte-stable system prefix
  │  4-5)                      │   • generateObject → typed IR (Zod)
  └───────────────────────────┘
              │ validated IR (Intermediate Representation)
              ▼
  ┌───────────────────────────┐   layered validator (src/validator/) — FAIL-CLOSED
  │ layer 1  schema (Zod)      │   structural bounds, depth/node caps,
  │ layer 2  block tree        │     additionalProperties:false; block name lenient here
  │ layer 3  theme.json        │   allowlist + containment grammar (core/html caught
  │ layer 4  assembled scan    │     as the "wp-html" invariant); token-value safety
  └───────────────────────────┘     (AJV vs vendored WP schema); post-assembly byte scan
              │ IRValidated         (each layer short-circuits on first failure)
              ▼
  ┌───────────────────────────┐   deterministic assembler (src/assembler/)
  │ pattern-manifest gate      │   SHA-256 integrity check on every seed blob FIRST
  │ → serializer + pattern     │   @wordpress/blocks serialize() is the parity oracle
  │   substitution             │   structured slot substitution (never string-replace)
  │ → nav provisioning         │   per-output-context injection defenses (CSS / PHP / path / URL)
  │ → fail-closed dup check    │
  │ → layer-4 byte scan        │   aborts assembly on any wp:html / hallucinated block
  └───────────────────────────┘
              │ assembled file tree
              ▼
  ┌───────────────────────────┐   byte-reproducible zip (src/assembler/zip.ts)
  │ STORE (not DEFLATE),       │   fixed UTC timestamps, NFC + LF normalization,
  │ sorted entries, pinned     │   pinned perms — asserted byte-for-byte vs golden zip
  │ unix perms                 │
  └───────────────────────────┘
              │ theme.zip
              ▼
  ┌───────────────────────────┐   Playground install/activate gate (src/harness/)
  │ headless WASM WordPress    │   WP 6.6 / PHP 8.2; unzip into wp-content/themes;
  │ (WP 6.6 / PHP 8.2)         │   switch_theme(); 4 runtime assertions:
  │                            │   activation clean · zero core/html + zero undelimited
  │                            │   HTML + zero unregistered blocks · no dropped theme.json
  │                            │   keys · navigation renders non-empty
  └───────────────────────────┘
              │
              ▼
        installable, render-verified Block Theme .zip
```

**Stage notes:**

- **AI orchestration** — Constrains the model to valid block syntax via a byte-stable system prefix (the allowlist enumeration, containment grammar, pattern catalog, attribute ranges, and an explicit prohibition on `wp:html`). The user's free text is HTML-encoded and isolated in a delimited slot so a crafted `</user_description>` or `wp:html` string cannot break out or forge instructions. Output is a typed **Intermediate Representation (IR)**, not raw markup — the model fills slot values and selects allowlisted blocks; it never writes block-comment delimiters. A bounded retry loop (3 attempts) feeds the structured validator errors back as corrections, with a pattern-only fallback on the final attempt.
- **Layered validator** — The authoritative correctness gate. Four layers run in fixed order, each short-circuiting on first failure; it never throws on untrusted input and never silently passes.
  - *Layer 1 (schema, Zod)* — structural bounds and an iterative depth/node-count pre-walk, then a parse that is **lenient on the block name** (`z.string().min(1)`) but still `additionalProperties:false` everywhere. An invented node-level key is rejected here; a `core/html` *value* is intentionally allowed through to layer 2.
  - *Layer 2 (block tree)* — allowlist membership + containment grammar. The IR authoring schema's `block` enum omits `core/html`, so a `core/html` value emitted by a generator that conforms to the published IR cannot exist; layer 2's explicit `core/html → "wp-html"` invariant tag is the belt-and-suspenders check for the lenient layer-1 path (any surviving case-variant string). It also tags hallucinated names.
  - *Layer 3 (theme.json)* — token-value safety (hex-only colors, charset-restricted sizes, explicit dangerous-CSS rejection) and AJV validation of the compiled `theme.json` against a vendored, SHA-pinned copy of the WordPress published JSON Schema.
  - *Layer 4 (assembled-artifact byte scan)* — see below; runs **post-assembly**, invoked by the assembler, not by `validateIR`.
- **Deterministic assembler** — Maps the validated IR to canonical WordPress markup, delegating serialization exclusively to `@wordpress/blocks` `serialize()` (the "parity oracle"). Before any byte flows, it runs a **SHA-256 pattern-manifest integrity gate** over every seed pattern blob (a supply-chain control: a tampered blob is caught before its bytes can enter the artifact). Pattern parameterization is **structured substitution**, never string replacement, with per-output-context escaping (style.css header, PHP body, zip entry path, URL scheme, token values). It runs the layer-4 byte scan last and aborts assembly on any violation.
- **Byte-reproducible zip** — STORE compression, a fixed UTC date stamp, NFC/LF normalization, sorted entries, and pinned unix permissions make the archive byte-identical across machines. A committed golden zip is asserted byte-for-byte in CI, so a zlib/locale/line-ending difference surfaces as a diff rather than a silent regression.
- **Playground install/activate gate** — Boots a headless WASM WordPress and genuinely installs the assembled archive into `wp-content/themes`, then runs four assertions (clean activation; zero `core/html` / zero undelimited HTML / zero unregistered blocks at render time; no dropped `theme.json` keys; non-empty navigation). This is the render-time backstop to the static byte scan.

**Defense in depth for the `wp:html` constraint.** Distinct mechanisms, each catching a different failure mode:

1. **IR enum exclusion** — `core/html` is absent from the block allowlist enum, so a conforming IR cannot represent the Custom HTML block at all. This is the primary gate; layer 1 rejects any other shape that tries to smuggle one in.
2. **Validator layer 2** — explicit `core/html → "wp-html"` invariant tag, a defensive belt that catches any case-variant string surviving the lenient layer-1 block-name parse.
3. **Pattern-manifest integrity gate** — SHA-256 over every seed blob, run first in assembly, so a tampered or compromised blob is rejected before its bytes can enter the artifact.
4. **Assembler layer-4 byte scan** — the shared `wp-html-scan` detector scans every assembled `.html`/`.php` file for raw `wp:html` delimiters (normalizing whitespace, control characters, and casing) and re-parses to catch undelimited HTML (`core/missing`) and hallucinated block names.
5. **Playground render gate** — asserts zero `core/html` (and zero undelimited HTML, and zero unregistered blocks) inside real WordPress at render time.

The single normalization rule and delimiter list live in one module (`src/assembler/wp-html-scan.ts`), imported by both the pre-substitution blob scan and the post-assembly layer-4 scan, so the two defenses cannot drift.

The **why** behind each decision — model choice, the envelope-strict / tree-best-effort IR strategy, alternatives rejected, security model — lives in [ADR-0002 — AI Theme-Generation Architecture](docs/adr/0002-ai-theme-generation-architecture.md), the consolidated decision record with a checkpoint-by-checkpoint timeline. It builds on [ADR-0001](docs/adr/0001-application-stack.md) (foundational stack); the phase PRDs at [`docs/phase-1-prd.md`](docs/phase-1-prd.md) and [`docs/phase-2-prd.md`](docs/phase-2-prd.md) carry the underlying detail. See [Links](#links).

---

## Project layout

```
/
├── app/
│   ├── page.tsx                 # Bare UI skeleton (Track 4 builds the input form here)
│   └── api/generate/route.ts    # POST handler: throttle → input cap → criteria check → spend guard → generateTheme → IR JSON
├── src/
│   ├── ir/                      # IR Zod schema + JSON Schema emission (schema.ts, types.ts, json-schema.ts)
│   ├── validator/               # Layered fail-closed validator (layer1-schema, layer2-blocktree,
│   │                            #   layer3-themejson, layer4-scan, errors.ts)
│   ├── themejson/               # theme.json compiler + vendored WP JSON Schema (compile.ts, load-schema.ts, schema/)
│   ├── blocks/                  # Block allowlist, per-block attribute validation, containment grammar
│   ├── assembler/               # Deterministic assembler: serializer, pattern substitution, escaping,
│   │                            #   pattern-manifest SHA-256 gate, byte-reproducible zip,
│   │                            #   shared wp:html scanner, golden/ zip
│   ├── harness/                 # WordPress Playground boot/install/activate runner (blueprint.ts, run.ts)
│   └── orchestration/           # AI orchestration: provider.ts, prompt.ts, generate.ts (C-single),
│                                #   decomposed.ts (C-decomposed), retry-loop.ts, reprompt.ts, limits.ts,
│                                #   telemetry.ts, contract.ts, ir-views.ts, producer-guards.ts,
│                                #   context-prefix.ts, index.ts
├── contract/                    # Frozen interface: ir-v1.schema.json, allowlist.json, error-format.md,
│                                #   prompt-contract.md
├── fixtures/                    # Adversarial corpus: positive/ (blog, landing, portfolio),
│                                #   hallucinated/, invalid-themejson/, wp-html/, composition/
├── tests/                       # smoke, contract, corpus; orchestration/; harness/ (slow); e2e/ (slow)
├── experiments/
│   └── first-try-success/       # §3.6 C-single vs C-decomposed harness (needs a real ANTHROPIC_API_KEY to run)
└── docs/                        # adr/, handoffs/, plans/, pattern-library/, phase-1-prd.md, phase-2-prd.md
```

---

## Testing & CI

| Command | What it runs |
|---|---|
| `npm test` | **Fast gate.** Unit + integration tests under `tests/**` and `src/**` (excludes `tests/harness/**`, `tests/e2e/**`). No WordPress, no live AI, no key. The provider is mocked. Completes in seconds. |
| `npm run test:slow` | **Slow / Playground gate.** Boots headless WASM WordPress (WP 6.6 / PHP 8.2) and runs `tests/harness/**` (install/activate assertions) + `tests/e2e/**` (full-pipeline integration). Files run sequentially (`fileParallelism: false`) to avoid races on the shared site directory; 180 s per-test timeout. No API key — the assembler path under test does not call the provider. |
| `npm run typecheck` | `tsc --noEmit` — full TypeScript strict check (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`). |
| `npm run lint` | ESLint with the `typescript-eslint` flat config. |

**CI is split into a fast gate and a slow gate** (`.github/workflows/`):

- **Fast gate** (`ci.yml`) — runs on every push to `main` and every PR, no path filter: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test`. This is the required branch-protection check; it runs in seconds.
- **Slow / Playground gate** (`ci-playground.yml`) — runs on every push to `main`, but on PRs **only** when assembler/blocks/IR/validator/themejson/harness/fixtures/pattern-library or the slow-test config change. It caches `~/.wordpress-playground` and runs `npm run test:slow`.

> **CI maintainers:** do **not** add the Playground gate to required branch-protection status checks. It is path-filtered, so it reports no status on docs-only PRs, and GitHub would block those merges waiting on a check that never arrives.

> **Drift note (Playwright).** [ADR-0001](docs/adr/0001-application-stack.md) names Playwright as the planned end-to-end tool. The realized harness is the headless WASM **WordPress Playground** gate instead — **Playwright is not a dependency** (it is absent from `package.json`, no test imports it, and neither Vitest config uses it). The e2e tests (`tests/e2e/`) run on Vitest + Playground. Treat ADR-0001's Playwright reference as superseded by execution; this README and the slow-gate workflow reflect the actual stack.

---

## Known limitations

These are documented, deliberate gaps — not defects to paper over:

1. **The HTTP route returns IR JSON, not a downloadable `.zip`.** `POST /api/generate` runs the orchestration spine and returns the validated IR (`{ status: "done", ir: {...} }`, HTTP 200; `{ status: "failed", errors: [...] }`, HTTP 422; `{ error: "generation_failed" }`, HTTP 502). The route also returns the operational opsec responses: `rate_limited` (429), `input_too_long` (400), `invalid_criteria` (400), and `capacity_exhausted` (503, when the per-instance provider spend budget is exhausted). The assembler (`src/assembler/`), zip packager (`src/assembler/zip.ts`), and Playground gate (`src/harness/`) all exist and are independently verified, but are **not yet wired** to the route. Connecting `route → assembler → Response(zip)` is the top functional next step before the app delivers its core value.
2. **No input UI.** `app/page.tsx` is a bare skeleton — no description field, no criteria form, no submit, no download trigger. The server seam is ready; the front end (Track 4) is unbuilt.
3. **Generation arm selection is pending (issue #23, human-in-the-loop).** Two arms exist: **C-single** (`src/orchestration/generate.ts` — one model call, the guaranteed-correct floor, **current default**) and **C-decomposed** (`src/orchestration/decomposed.ts` — per-region fan-out, potentially higher quality). The `experiments/first-try-success/` harness compares both, but a verdict requires a live `ANTHROPIC_API_KEY` and token spend. Until that run happens, the arm-selection config point in `src/orchestration/index.ts` stays on C-single. Flipping it is a one-line swap.
4. **The supported-block allowlist is a deliberately closed set.** `contract/allowlist.json` enumerates the blocks the system will author (it excludes `core/html`, `core/shortcode`, `core/freeform`, and all third-party namespaces). Expansion is an explicit PR, never a runtime fallback — so a generator request that needs a block outside the set fails loudly rather than degrading into a free-tree escape hatch. Pattern-library breadth (and therefore design distinctiveness) is bounded accordingly; the breadth roadmap is in [`docs/phase-2-prd.md`](docs/phase-2-prd.md) and "What I'd Do Next" (pending).

---

## Links

- **ADR-0001 — Application stack:** [`docs/adr/0001-application-stack.md`](docs/adr/0001-application-stack.md) (Node/TypeScript, Next.js App Router, Vercel AI SDK, AJV, Vitest, JSZip, WordPress Playground, npm; provider default with the model tier deferred to Phase 2). *Note: it lists Playwright for e2e, which execution superseded with the Playground gate — see the Drift note above.*
- **ADR-0002 — AI theme-generation architecture:** [`docs/adr/0002-ai-theme-generation-architecture.md`](docs/adr/0002-ai-theme-generation-architecture.md) — the consolidated decision record: an end-to-end summary, a checkpoint-by-checkpoint decision timeline, and deep-dives on model choice, the envelope-strict / tree-best-effort IR strategy, alternatives rejected, the `wp:html` defense in depth, security, and design exploration. The phase PRDs ([`docs/phase-1-prd.md`](docs/phase-1-prd.md), [`docs/phase-2-prd.md`](docs/phase-2-prd.md)) and [`docs/plans/`](docs/plans) carry the supporting detail.
- **Project brief:** [`References/Automattic_Project-Brief.pdf`](References/Automattic_Project-Brief.pdf).
- **"What I'd Do Next":** [`docs/what-id-do-next.md`](docs/what-id-do-next.md) — the next-week priorities (wire the assembler to the HTTP route, build the Track-4 UI, lock the issue-#23 arm, grow the pattern library), production-readiness gaps (shared rate-limit/spend state, provider backoff, the formal validation pipeline, observability), and a scaling discussion. ADR-0002 §8 carries the same open decisions as a terse status index.

> One note on naming for scanners and reviewers: throughout this repo the disqualifying block is referred to as `wp:html` or "the Custom HTML block" rather than written as a literal block delimiter, so that documentation prose never trips the same byte scan that guards generated output.
