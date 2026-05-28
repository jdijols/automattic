// Layer 3 — theme.json validation (origin §5.1 step 3). Owns the
// invalid-theme.json invariant. Three checks:
//   1. AJV against the vendored draft-07 schema — unknown keys, version
//      mismatch, type/enum errors (the silent-drop hazards caught up front).
//   2. token VALUE validation — hex colors, safe size values — to close the
//      CSS-injection vector a `string`-typed schema field leaves open (§6.4).
//   3. core-slug-reuse-without-flag — a v3 semantic the schema cannot express
//      (the preset is silently dropped at runtime, origin §3.2).
import Ajv, { type ErrorObject } from "ajv";

import { type DesignTokens } from "../ir/schema";
import {
  CORE_COLOR_SLUGS,
  CORE_FONT_SIZE_SLUGS,
  CORE_SPACING_SLUGS,
  compileThemeJson,
} from "../themejson/compile";
import { loadThemeSchema } from "../themejson/load-schema";
import { type ValidationError, makeError } from "./errors";
import { isPlainObject } from "./layer1-schema";

const ajv = new Ajv({ strict: false, allErrors: true });
const validateSchema = ajv.compile(loadThemeSchema());

// Hex colors only (origin §3.2 / §6.4): 3/6/8-digit. A value like
// "#f00; } body{…}" is not hex → rejected, closing the CSS-injection vector.
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Safe CSS length/clamp/calc: digits, units, %, parens, commas, math ops, space.
// Excludes ; { } < > " ' ` \ — the breakout characters.
const SIZE_CHARSET = /^[0-9a-z.%,()\s+*/-]+$/i;
// …but the charset alone still admits dangerous value-position CSS functions and
// comment delimiters that need no breakout. Reject those substrings explicitly
// (the §6.4 token-value defense): url()/expression()/image-set()/attr()/var()
// reach a CSS sink, and /* */ can comment out adjacent generated declarations.
const DANGEROUS_CSS = /url\s*\(|expression|image-set|attr\s*\(|var\s*\(|\/\*|\*\//i;

function isSafeSize(value: string): boolean {
  return SIZE_CHARSET.test(value) && !DANGEROUS_CSS.test(value);
}

function themeJsonError(message: string): ValidationError {
  return makeError({
    code: "THEME_JSON_INVALID",
    layer: "theme-json",
    path: "theme.json",
    message,
    invariant: "invalid-theme-json",
  });
}

function tokenValueError(path: string, message: string): ValidationError {
  return makeError({
    code: "TOKEN_VALUE_INVALID",
    layer: "theme-json",
    path,
    message,
    invariant: "invalid-theme-json",
  });
}

/** Per-category token VALUE validation — the CSS-injection defense. */
export function validateTokenValues(tokens: DesignTokens): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const c of tokens.colors ?? []) {
    if (!HEX_COLOR.test(c.color)) {
      errors.push(
        tokenValueError(
          `tokens.colors.${c.slug}`,
          `Color token '${c.slug}' must be a hex value (#rgb/#rrggbb/#rrggbbaa); got ${JSON.stringify(c.color)}.`,
        ),
      );
    }
  }

  for (const group of ["fontSizes", "spacing"] as const) {
    for (const s of tokens[group] ?? []) {
      if (!isSafeSize(s.size)) {
        errors.push(
          tokenValueError(
            `tokens.${group}.${s.slug}`,
            `Size token '${s.slug}' contains disallowed characters; got ${JSON.stringify(s.size)}.`,
          ),
        );
      }
    }
  }

  return errors;
}

/** Format an AJV error to a clean message — never the raw AJV error object. */
function formatAjvError(err: ErrorObject): string {
  const at = err.instancePath ? `theme.json${err.instancePath.replace(/\//g, " › ")}` : "theme.json";
  const extra =
    err.keyword === "additionalProperties" && typeof err.params.additionalProperty === "string"
      ? ` ('${err.params.additionalProperty}')`
      : "";
  return `${at} ${err.message ?? "is invalid"}${extra}.`;
}

/** Does this fontSizes/spacing array reuse a core slug without the default-disable flag? */
function reuseWithoutFlag(
  presets: unknown,
  defaultsDisabled: unknown,
  coreSlugs: Set<string>,
): boolean {
  if (!Array.isArray(presets) || defaultsDisabled === false) return false;
  return presets.some((p) => isPlainObject(p) && typeof p.slug === "string" && coreSlugs.has(p.slug));
}

/** AJV schema validation + the core-slug-reuse semantic check. */
export function validateThemeJson(themeJson: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!validateSchema(themeJson)) {
    for (const err of validateSchema.errors ?? []) {
      errors.push(themeJsonError(formatAjvError(err)));
    }
  }

  if (isPlainObject(themeJson) && isPlainObject(themeJson.settings)) {
    const settings = themeJson.settings;
    const color = isPlainObject(settings.color) ? settings.color : undefined;
    const typography = isPlainObject(settings.typography) ? settings.typography : undefined;
    const spacing = isPlainObject(settings.spacing) ? settings.spacing : undefined;
    if (color && reuseWithoutFlag(color.palette, color.defaultPalette, CORE_COLOR_SLUGS)) {
      errors.push(
        themeJsonError(
          "A custom color preset reuses a core slug without settings.color.defaultPalette:false; it would be silently dropped.",
        ),
      );
    }
    if (typography && reuseWithoutFlag(typography.fontSizes, typography.defaultFontSizes, CORE_FONT_SIZE_SLUGS)) {
      errors.push(
        themeJsonError(
          "A custom fontSize preset reuses a core slug without settings.typography.defaultFontSizes:false; it would be silently dropped.",
        ),
      );
    }
    if (spacing && reuseWithoutFlag(spacing.spacingSizes, spacing.defaultSpacingSizes, CORE_SPACING_SLUGS)) {
      errors.push(
        themeJsonError(
          "A custom spacing preset reuses a core slug without settings.spacing.defaultSpacingSizes:false; it would be silently dropped.",
        ),
      );
    }
  }

  return errors;
}

/** Layer 3 over an IR: validate token values, compile, then validate the theme.json. */
export function layer3(ir: { tokens: DesignTokens }): ValidationError[] {
  // Fail fast on unsafe token values — don't compile a flagged value into the
  // theme.json (avoids double-reporting one defect and never feeds a rejected
  // value into the compiler).
  const valueErrors = validateTokenValues(ir.tokens);
  if (valueErrors.length > 0) return valueErrors;
  return validateThemeJson(compileThemeJson(ir.tokens));
}
