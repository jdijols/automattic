# IR forcing-function notes

What authoring the three seed patterns revealed about the **intermediate representation** (the typed contract between the AI and the assembler — PRD §2) and the **validator** (PRD §5). These are bottom-up findings to reconcile with `docs/phase-1-prd.md` *after* the loop converges (we don't edit the PRD mid-loop).

Headline: **the patterns are strong evidence against PRD Q1 option A (free block-tree) and for option C (hybrid: pattern-reference nodes + parameterization slots).** Reasoning below.

## 1. Static subtree ≠ template subtree

The hero is a static tree. The query-loop's `post-template` is a **template applied per-post** — its `post-*` children render N times against N different posts. A flat "block tree" IR conflates these. The IR needs two distinct node kinds:

- **static node** — renders once, as authored
- **template region** — an inner subtree applied per item in a dynamic context (query loop, comment loop)

This alone breaks the naive free-tree model. → feeds **PRD Q1**.

## 2. Tokens are references, not values

Every color/font/spacing in all three patterns is `var:preset|...`, never a literal. The IR carries token *references* (slot → vocabulary entry); `theme.json` carries the token *definitions*. Two-sided contract:

- IR says: "this heading's color = token `base`"
- theme.json says: "`base` = #FFFFFF" (the AI's per-vision choice)

The IR must validate that every token reference resolves against the vocabulary the theme.json declares. A dangling `var:preset|color|brand` (no `brand` in the palette) is an invalid-but-parseable failure the validator must catch. → feeds **PRD Q2/Q5**.

## 3. A flat allowlist is necessary but not sufficient

`post-*` blocks are only valid inside `core/post-template`. `query-pagination-*` only inside `core/query-pagination`. The validator needs **context rules** (valid-parent / valid-ancestor constraints), not just a flat set of allowed block names. → directly sharpens **PRD Q4** (the allowlist must be a *grammar*, not a set).

## 4. Parameterizable vs. locked is a first-class distinction

Each `meta.json` splits the surface into `parameterizable` (content, tokens, some structural knobs) and `locked` (nesting, structure). This is the strongest signal: the IR the AI emits should be **"pattern reference + slot assignments,"** not a free tree it authors node-by-node. The AI picks `hero-cover` and fills its declared slots; it does not get to restructure the cover→group→heading nesting. → strong evidence for **PRD Q1 = option C (hybrid)**: pattern-reference nodes for covered regions, constrained free-tree only for gaps the library doesn't cover.

## 5. The IR carries provisioning requirements, not just markup

`core/navigation` needs a `wp_navigation` menu entity. `core/site-title` reads site settings. These are **site-data dependencies** — the assembler must provision defaults (create a menu, set a title) or the blocks render empty. The IR must flag "this composition requires menu X / setting Y," and the assembler's contract includes provisioning, not just file emission. → adds a dimension to **PRD §6 (assembler)** that the v0 PRD may under-specify.

## 6. Validation is two-layered: per-pattern AND cross-pattern

Some invariants live inside one pattern (hero's nesting). Others are **cross-pattern composition rules** that no single pattern can guarantee:

- exactly one `h1` per page (hero owns it; everything else h2+)
- heading-outline sanity across the assembled page
- region uniqueness (one hero, one footer)

This means the validator (PRD Q5) needs at least two passes: **(a) per-pattern structural validation** and **(b) post-composition document validation**. The v0 PRD's "per-layer vs end-to-end" framing should resolve to *both layers exist* — they catch different failure classes. → sharpens **PRD Q5**.

## 7. Two more typed sub-surfaces the IR must model

- **Query configuration** — `query` carries `perPage / orderBy / order / postType / inherit` — a constrained enum/int surface, NOT free content. The IR models it as a typed sub-object the AI fills within bounds.
- **Block style variations** — `is-style-outline` (button), `is-style-logos-only` (social-links) reference style variations the theme must register. The IR's style vocabulary includes named variations, not just tokens.

## Net recommendation for PRD reconciliation

When the loop converges and we reopen `phase-1-prd.md`:

1. **Resolve Q1 → option C (hybrid).** These patterns demonstrate the AI should compose pattern-references + fill declared slots, with constrained free-tree reserved only for uncovered gaps. Free block-tree authoring (option A) reintroduces exactly the hallucination surface the strategy exists to remove.
2. **Reframe Q4** from "block-name allowlist" to "block grammar with context rules."
3. **Resolve Q5 → two validation layers** (per-pattern + post-composition), not one-or-the-other.
4. **Expand §6 (assembler)** to include site-data provisioning, not just file emission.
5. Add a PRD note that the IR carries: node-kind (static | template-region), token references, query-config sub-objects, style-variation references, and provisioning requirements.

These are findings from three patterns. The full library will surface more — but the IR shape is already strongly implied.
