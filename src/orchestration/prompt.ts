// T3-U2 — prompt assembly with the input-stage trust boundary (origin §6.4, R4;
// contract/prompt-contract.md). The end user's free text is UNTRUSTED DATA, not
// instructions:
//   • the fixed instruction segment is the cacheable prefix (`context-prefix.ts`)
//     and is returned as `system` — the user string is NEVER interpolated into it;
//   • the variable suffix (`prompt`) carries the user text inside a delimited
//     <user_description> slot and the typed criteria inside <structured_criteria>;
//   • the single 5-min cache breakpoint sits between the two (the prefix is the
//     cache target — see provider.ts).
//
// Defense-in-depth: angle brackets in the user description are HTML-encoded, so a
// crafted `</user_description>` or `<!-- wp:html -->` cannot forge a tag or break
// out of the slot. Structured criteria are validated against a typed schema with
// bounded, enum/hex/word-only fields, so they cannot smuggle markup either. The
// validator + layer-4 scan remain the authoritative output gate regardless.
import * as z from "zod";

import { buildContextPrefix } from "./context-prefix";

const HEX = /^#[0-9a-fA-F]{3,8}$/;
// Font family: letters, digits, spaces, hyphens, commas (font stacks) only — no
// angle brackets, quotes, or punctuation that could carry markup.
const FONT = /^[\w ,-]{1,60}$/;

/** Typed, bounded structured criteria — every field is injection-safe by shape. */
export const structuredCriteriaSchema = z.strictObject({
  siteType: z
    .enum(["blog", "portfolio", "landing", "store", "magazine", "business", "personal", "documentation"])
    .optional(),
  palette: z
    .strictObject({
      primary: z.string().regex(HEX).optional(),
      secondary: z.string().regex(HEX).optional(),
      background: z.string().regex(HEX).optional(),
      text: z.string().regex(HEX).optional(),
    })
    .optional(),
  typography: z
    .strictObject({
      headingFont: z.string().regex(FONT).optional(),
      bodyFont: z.string().regex(FONT).optional(),
    })
    .optional(),
});

export type StructuredCriteria = z.infer<typeof structuredCriteriaSchema>;

export interface BuildPromptInput {
  /** The end user's free-text site description — untrusted data. */
  userDescription: string;
  /** Optional typed criteria (color palette, typography, site type). */
  criteria?: StructuredCriteria;
  /**
   * Optional retry-correction suffix (T3-U4). Appended AFTER the data slots so
   * the byte-stable system prefix is unchanged across retries (the cache stays
   * warm). The correction is Track-3-built instruction text whose user-derived
   * fragments (path/hint) are already sanitized by `reprompt.ts`.
   */
  correction?: string;
}

export interface BuiltPrompt {
  /** The cacheable instruction prefix (the cache breakpoint terminates this). */
  system: string;
  /** The variable user-data suffix: the two isolated, delimited slots. */
  prompt: string;
}

/**
 * HTML-encode `&`, `<`, `>` so no angle-bracket sequence can forge a tag or a
 * block-comment / PHP delimiter. Used for the user-description slot and for
 * sanitizing user-data-derived re-prompt fragments (T3-U4 path/hint).
 */
export function htmlEncode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Assemble the generation prompt. `system` is the byte-stable prefix; `prompt`
 * is the user-data suffix. The user string lives ONLY inside the encoded
 * <user_description> slot; criteria are validated to the typed schema first.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const parsed = structuredCriteriaSchema.safeParse(input.criteria ?? {});
  if (!parsed.success) {
    // Bounded error — never surfaces the raw Zod dump (origin §8.3).
    throw new Error("Invalid structured criteria: each field must match the typed schema (enum/hex/font-name).");
  }

  const correction = input.correction ? `\n${input.correction}\n` : "";
  const prompt = `<user_description>
${htmlEncode(input.userDescription)}
</user_description>

<structured_criteria>
${JSON.stringify(parsed.data)}
</structured_criteria>
${correction}
Emit only the IR object.`;

  return { system: buildContextPrefix(), prompt };
}
