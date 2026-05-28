# Track-1 Frozen Contract — Structured Error Format

**Status: frozen at U7.** This is the stable interface Track 3 (AI orchestration)
and Track 4 (UI) code against. The `code` enum below is **complete across all four
validator layers** and does not grow in Phase B — layer-3 and layer-4 codes are
declared now even though their producers (U5/U9) landed/land separately.

Generated artifacts in this directory:
- `ir-v1.schema.json` — the publishable IR JSON Schema (draft-2020-12), emitted
  from the same Zod source the validator enforces (drift-guarded in CI).
- `allowlist.json` — the closed block allowlist.
- `error-format.md` — this file.
- `prompt-contract.md` — the input-stage trust boundary + reference prompt template.

## The validator entry point

```ts
validateIR(input: unknown): ValidationResult<IRValidated>
```

`ValidationResult<T>` is a discriminated union — **never a thrown exception on bad
input, never a silent pass**:

```ts
type ValidationResult<T> =
  | { ok: true;  value: T }                 // a typed, validated artifact
  | { ok: false; errors: ValidationError[] }; // a structured error list
```

> Track 3 note: success is keyed on **`.value`** (typed `IRValidated`), not `.ir`.
> Call `validateIR` and branch on `result.ok`.

## The error object (frozen field set)

```ts
interface ValidationError {
  code: ErrorCode;        // closed enum, below
  layer: ValidationLayer; // "schema" | "block-tree" | "theme-json" | "assembled-artifact"
  path: string;           // root-to-node, e.g. "templates/index.html › core/query › core/scroll-spy"
  message: string;        // human-legible (Track 4 renders this). Never a raw Zod/AJV dump.
  invariant: Invariant;   // "wp-html" | "hallucinated-block-name" | "invalid-theme-json" | null
  hint?: string;          // optional retry steer for Track 3; ≤200 chars, whitespace-collapsed, no schema fragments
}
```

**Must-not-see boundary:** raw AJV/Zod internals are never surfaced. Track 3's
re-prompt is built only from `code` + `path` + the bounded `hint`; Track 4 renders
only `message`. Treat `path`/`hint` as user-data-derived — normalize before
re-injecting into a prompt (they are not pre-stripped of `<!-- wp:` / `?>`).

## The complete `code` enum

### Layer 1 — schema (`layer: "schema"`)
- `MALFORMED_INPUT` — input is not parseable JSON / not an object.
- `SCHEMA_VALIDATION` — fails the IR Zod schema (e.g. invented key, bad slug, non-allowlisted `block`).
- `DEPTH_BOUND_EXCEEDED` — nesting deeper than the depth bound (resource-exhaustion guard, pre-walk).
- `NODE_COUNT_EXCEEDED` — total node count over the bound (pre-walk).

### Layer 2a — block-tree, per node (`layer: "block-tree"`)
- `BLOCK_NOT_ALLOWED` — block not in the allowlist (`invariant: "hallucinated-block-name"`, or `"wp-html"` for any casing of `core/html`).
- `BLOCK_CONTAINMENT` — block in an illegal parent/ancestor, or a `patternRef` inside a closed-children container.
- `ATTRIBUTE_UNKNOWN` — attribute key neither block-specific nor a common supports attribute.
- `ATTRIBUTE_OUT_OF_RANGE` — value outside the overlay range (e.g. `heading.level` ∉ 1..6).
- `ATTRIBUTE_UNSAFE_URL` — URL attribute with a disallowed scheme (only http/https/mailto/tel pass).
- `QUERY_CONFIG_INVALID` — `core/query` config outside the typed bounds.
- `PATTERN_NOT_FOUND` — `patternRef.pattern` does not resolve in the catalog.
- `PATTERN_PARAM_KIND_MISMATCH` — a `params` slot's `kind` does not match the pattern's declared slot kind.

### Layer 2b — post-composition (`layer: "block-tree"`)
- `MULTIPLE_H1` — more than one `h1` across the page.
- `HEADING_OUTLINE` — heading-outline sanity violation.
- `REGION_NOT_UNIQUE` — duplicate singleton region (e.g. two heroes/footers).
- `DANGLING_TOKEN_REFERENCE` — a token reference that resolves against neither the IR `tokens` palette nor a WordPress core default preset. **Fires for color, font-size, AND spacing slugs** (and bare-slug attrs like `backgroundColor`/`fontSize`) — not color-only.

### Layer 3 — theme.json (`layer: "theme-json"`)
- `THEME_JSON_INVALID` — fails the vendored draft-07 schema, or reuses a core preset slug without the default-disable flag.
- `TOKEN_VALUE_INVALID` — unsafe token value (bad hex, dangerous CSS function/comment in a size, etc.).

### Layer 4 — assembled-artifact (`layer: "assembled-artifact"`, produced in U9)
- `RAW_HTML_DETECTED` — a raw `wp:html` delimiter found in the assembled byte stream.
- `UNRESOLVED_BLOCK_NAME` — a block name in the assembled artifact that re-parses as unknown.

## Known scope edges Track 3 must not rely on the validator to catch (MVP)

- **Gradient token references are NOT resolved.** The layer-2b dangling-token check
  skips `var:preset|gradient|…` (a documented known false-negative). A bad gradient
  ref passes both the producer guard and the validator silently — Track 3 owns
  gradient correctness on the producer side.
- **Pattern-internal headings are opaque.** `MULTIPLE_H1` walks `blockNode`s only;
  `patternRef` bodies are not introspected. "Pattern-only" output is guaranteed valid
  *as far as the validator sees*, not absolutely.
