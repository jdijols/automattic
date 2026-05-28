# Pattern Library (seed)

Track 2's taste backbone, seeded. Per [`STRATEGY.md`](../../STRATEGY.md): *"distinctive design comes from a curated palette of designer-quality block patterns the AI composes and parameterizes, not from the AI inventing layouts from scratch."*

The AI **selects + parameterizes** these patterns. It never authors new ones. Distinctiveness comes from (a) which patterns get composed, (b) the token values the AI assigns, and (c) optional content/media slots — layered on a fixed, hand-validated structure.

This is a **seed** (3 patterns), not the full library. It exists to: seed Track 2, serve as a forcing function for the IR contract (see [`IR-notes.md`](IR-notes.md)), and become the validator's first test fixtures in Phase 1.

## Patterns

| Pattern | Region | Exercises (IR challenge) |
|---|---|---|
| [`hero-cover`](hero-cover/) | hero | Static nested subtree + overlay + the single h1 |
| [`query-loop-list`](query-loop-list/) | content | Dynamic block with an inner **template** applied per-post (the hard case) |
| [`site-footer`](site-footer/) | footer | Multi-column + site-data-dependent blocks (navigation, site-title) |

Each pattern is `pattern.html` (valid native block markup, **zero `wp:html`**) + `meta.json` (region, blocks used, tokens accepted, parameterizable vs locked surface, composition rules).

## Token vocabulary

The fixed vocabulary the AI fills via `theme.json`. Patterns reference these by slug; the AI assigns concrete values per the user's vision.

**Color (palette slugs):** `base` (page background / light text on dark), `contrast` (primary text / dark surfaces), `primary` (brand accent — buttons, links), `secondary` (muted — meta, dates).

**Font size (slugs):** `small`, `medium`, `large`, `x-large`, `xx-large`, `xxx-large`.

**Spacing (slugs, WordPress numeric convention):** `30`, `40`, `50`, `60`, `70`, `80` (small → large).

## De-facto block allowlist (feeds PRD §4)

The union of blocks these three patterns use — a concrete starting point for the MVP block-name allowlist:

```
Static:   core/cover, core/group, core/columns, core/column,
          core/heading, core/paragraph, core/buttons, core/button
Query:    core/query, core/post-template, core/post-featured-image,
          core/post-title, core/post-date, core/post-excerpt,
          core/query-pagination, core/query-pagination-previous,
          core/query-pagination-numbers, core/query-pagination-next
Site:     core/site-title, core/navigation, core/social-links, core/social-link
```

## Composition rules (cross-pattern invariants)

These hold *across* patterns and are the assembler's job to enforce — no single pattern can guarantee them alone:

1. **One `h1` per page.** The hero owns it (`level:1`). Content sections use `h2`, sub-sections `h3`. The assembler validates the document outline after composition.
2. **`post-*` blocks are context-bound.** Only valid inside a `core/post-template` (itself inside `core/query`). The validator rejects them anywhere else.
3. **Region uniqueness.** hero and footer occur once per page; content feeds typically once.
4. **Site-data dependencies.** `navigation` needs a menu entity; `site-title` reads site settings. The assembler must provision defaults or these render empty.

## Status

These are reference-quality and structurally hand-checked, but **not yet machine-validated** — the validator doesn't exist until Phase 1. When it does, these become its first fixtures, and any byte-exact-serialization decision (PRD Q6) gets applied to them then. Optional earlier check: load each `pattern.html` in WordPress Playground to confirm it renders without "attempt block recovery."
