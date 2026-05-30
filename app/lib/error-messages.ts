// T4-U3 — pure (status, body) → UI-message mapping for the §5.2 structured errors.
//
// The route returns a .zip on 200 and a structured JSON error otherwise. This turns
// each failure into field-level messages (description / criteria / form) plus, for a
// 422, the per-issue validator list ({code, layer, path, message}). For every NON-422
// status it emits a fixed, human-legible string chosen by the known error code and
// never echoes the body (so a credential riding along in, e.g., a 502 detail can't
// reach the DOM). For a 422 it copies only the four frozen ValidationError fields —
// each CLAMPED to a max length and the list capped at MAX_ISSUES (with a visible
// "+N more" note, never a silent cut) — so a malformed/oversized validator payload
// cannot flood the DOM. Kept pure so the React layer renders pre-shaped text and this
// is unit-tested alone.

export type ErrorField = "description" | "criteria" | "form";

export interface FieldError {
  field: ErrorField;
  message: string;
}

/** One legible row of the validator's 422 list (the frozen contract fields only). */
export interface GenerationIssue {
  code: string;
  layer: string;
  path: string;
  message: string;
}

export interface ErrorDisplay {
  /** A short heading for the whole failure. */
  title: string;
  /** Field-anchored errors to render near the relevant input(s). */
  fieldErrors: FieldError[];
  /** The per-issue validator list (422 only); empty otherwise. */
  issues: GenerationIssue[];
}

/** Most validator issues to render; an oversized payload is capped (see below). */
export const MAX_ISSUES = 50;
/** Per-field clamp so a single huge string can't bloat the DOM. */
const MAX_FIELD_LEN = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > MAX_FIELD_LEN ? `${value.slice(0, MAX_FIELD_LEN)}…` : value;
}

/** The frozen 422 error shape (contract/error-format.md) — copied field-by-field. */
function toIssue(raw: unknown): GenerationIssue {
  const e = isRecord(raw) ? raw : {};
  return { code: str(e.code), layer: str(e.layer), path: str(e.path), message: str(e.message) };
}

const FORM = (message: string): FieldError[] => [{ field: "form", message }];

/**
 * Map an unsuccessful response to a renderable error. `status` is the HTTP status;
 * `body` is the parsed JSON body (or anything — this never trusts its shape).
 */
export function describeError(status: number, body: unknown): ErrorDisplay {
  const code = isRecord(body) ? str(body.error) : "";

  if (status === 400 && code === "input_too_long") {
    return {
      title: "Description is too long",
      fieldErrors: [{ field: "description", message: "Your description is too long — keep it under 4000 characters." }],
      issues: [],
    };
  }
  if (status === 400 && code === "invalid_criteria") {
    return {
      title: "Check your criteria",
      fieldErrors: [
        {
          field: "criteria",
          message: "One of the colors or fonts isn't valid. Colors must be hex (e.g. #3858E9); fonts use letters, spaces, commas, or hyphens.",
        },
      ],
      issues: [],
    };
  }
  if (status === 400) {
    return { title: "Invalid request", fieldErrors: FORM("That request couldn't be read. Add a description and try again."), issues: [] };
  }

  if (status === 422) {
    const rawErrors = isRecord(body) ? body.errors : undefined;
    if (Array.isArray(rawErrors) && rawErrors.length > 0) {
      const issues = rawErrors.slice(0, MAX_ISSUES).map(toIssue);
      const overflow = rawErrors.length - issues.length;
      return {
        title: "The generated theme didn't validate",
        // Surface the cut explicitly — never a silent truncation.
        fieldErrors: overflow > 0 ? FORM(`…and ${overflow} more issue${overflow === 1 ? "" : "s"} not shown.`) : [],
        issues,
      };
    }
    return {
      title: "The generated theme didn't validate",
      fieldErrors: FORM("The model's output didn't pass validation. Try rephrasing your description and generating again."),
      issues: [],
    };
  }

  if (status === 429) {
    return { title: "Too many requests", fieldErrors: FORM("You're going a little fast — wait a moment and try again."), issues: [] };
  }
  if (status === 503) {
    return { title: "At capacity", fieldErrors: FORM("The generator is busy right now. Please try again later."), issues: [] };
  }
  if (status === 502) {
    return { title: "Generation failed", fieldErrors: FORM("Something went wrong while generating. Please try again."), issues: [] };
  }

  return { title: "Something went wrong", fieldErrors: FORM("Unexpected error. Please try again."), issues: [] };
}
