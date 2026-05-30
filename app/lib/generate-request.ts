// T4-U3 — pure form-state → POST-body builder for the input UI.
//
// The form keeps every field as a string (controlled inputs). The route's strict
// structuredCriteriaSchema rejects empty strings (an empty hex "" fails the HEX
// regex → 400 invalid_criteria), so this prunes blanks: a color/font is sent only
// when non-empty, the palette/typography objects only when they have ≥1 field, and
// criteria only when something is set. Trimming happens here too. Kept dependency-
// free (a `type`-only import of the route's criteria type, erased at build) so it
// can be unit-tested without the React layer and without bundling orchestration.
import type { StructuredCriteria } from "@/orchestration/prompt";

/** The flat, all-strings criteria the form binds its controlled inputs to. */
export interface CriteriaForm {
  siteType: string;
  primary: string;
  secondary: string;
  background: string;
  text: string;
  headingFont: string;
  bodyFont: string;
}

export interface GenerateForm {
  description: string;
  criteria: CriteriaForm;
}

export interface GenerateBody {
  userDescription: string;
  criteria?: StructuredCriteria;
}

/** A blank form — the React initial state and the test baseline. */
export function emptyForm(): GenerateForm {
  return {
    description: "",
    criteria: { siteType: "", primary: "", secondary: "", background: "", text: "", headingFont: "", bodyFont: "" },
  };
}

/** The site types the route accepts (mirrors structuredCriteriaSchema's enum). */
export const SITE_TYPES = [
  "blog",
  "portfolio",
  "landing",
  "store",
  "magazine",
  "business",
  "personal",
  "documentation",
] as const;

/** Collect the non-empty (trimmed) entries of `pairs` into an object, or undefined. */
function compact<K extends string>(pairs: readonly (readonly [K, string])[]): Record<K, string> | undefined {
  const out: Record<K, string> = {} as Record<K, string>;
  let any = false;
  for (const [key, raw] of pairs) {
    const value = raw.trim();
    if (value.length > 0) {
      out[key] = value;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Map the flat form state to the route body, pruning every blank field. */
export function buildGenerateBody(form: GenerateForm): GenerateBody {
  const c = form.criteria;
  const palette = compact([
    ["primary", c.primary],
    ["secondary", c.secondary],
    ["background", c.background],
    ["text", c.text],
  ]);
  const typography = compact([
    ["headingFont", c.headingFont],
    ["bodyFont", c.bodyFont],
  ]);
  const siteType = c.siteType.trim();

  const criteria: StructuredCriteria = {};
  if (siteType.length > 0) criteria.siteType = siteType as StructuredCriteria["siteType"];
  if (palette) criteria.palette = palette;
  if (typography) criteria.typography = typography;

  const body: GenerateBody = { userDescription: form.description.trim() };
  if (Object.keys(criteria).length > 0) body.criteria = criteria;
  return body;
}
