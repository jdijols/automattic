// T3-U8 — the experiment corpus (origin §5.3 / §3.6): the positive seed fixtures
// × k=3 paraphrased natural-language prompts each. The arms generate from these
// prompts; success is measured against the Track-1 validator (layers 1–3).
//
// Scope is FROZEN and logged (no silent cap): exactly the 3 positive archetypes,
// k=3 paraphrases each, judged by validateIR layers 1–3. The fixtures are the
// §6 positive corpus; their presence is the P2 precondition the harness checks
// before reporting any verdict.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Paraphrases per archetype (the experiment's distinctness probe). */
export const K = 3;

/** The positive seed archetypes (origin §5.3). */
export const POSITIVE_ARCHETYPES = ["blog", "landing", "portfolio"] as const;
export type Archetype = (typeof POSITIVE_ARCHETYPES)[number];

// k=3 paraphrased prompts per archetype — same intent, different surface wording,
// so the experiment measures robustness to phrasing, not a single canned string.
const PARAPHRASES: Record<Archetype, readonly string[]> = {
  blog: [
    "A clean blog with a hero, a list of recent posts, and a footer.",
    "Build me a writing site: a banner up top, a feed of articles, and a footer.",
    "I want a minimal blog — big header image, the latest posts below, footer at the bottom.",
  ],
  landing: [
    "A landing page with a hero, a three-column feature grid, call-to-action buttons, and a footer.",
    "Make a product launch page: bold hero, three features side by side, CTA buttons, footer.",
    "Marketing one-pager — hero section, 3 feature columns, prominent buttons, and a footer.",
  ],
  portfolio: [
    "A photographer's portfolio with a hero and a three-column image grid plus a footer.",
    "Show my photo work: a striking hero, a grid of images in three columns, footer.",
    "Minimal portfolio site — hero image, three-column gallery, footer.",
  ],
};

export interface CorpusEntry {
  archetype: Archetype;
  /** The reference fixture input (the known-valid IR for this archetype). */
  fixtureInput: unknown;
  /** The k paraphrased NL prompts. */
  prompts: readonly string[];
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/positive/${name}/${name}.json`, import.meta.url));
}

/**
 * Load the experiment corpus. Throws if a fixture is missing — the caller treats
 * that as the P2 precondition being unmet (do not report a verdict against a
 * missing/absent corpus).
 */
export function loadCorpus(): CorpusEntry[] {
  return POSITIVE_ARCHETYPES.map((archetype) => {
    const raw = JSON.parse(readFileSync(fixturePath(archetype), "utf8")) as { input: unknown };
    return { archetype, fixtureInput: raw.input, prompts: PARAPHRASES[archetype] };
  });
}
