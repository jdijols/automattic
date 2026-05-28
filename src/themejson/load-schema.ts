// Loader for the vendored WordPress theme.json schema (origin §3.1, Q2).
//
// The schema is `src/themejson/schema/theme-v3.json`, vendored on 2026-05-28 from
// https://schemas.wp.org/trunk/theme.json — JSON Schema draft-07 with
// `version: const 3`, directly consumable by AJV. The committed file IS the pin
// (we never fetch at runtime). EXPECTED_SHA256 is asserted on load so a
// substituted or in-tree-tampered schema fails loudly at build time (origin
// §3.1 security note), rather than silently validating against the wrong rules.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** SHA-256 of the vendored theme-v3.json. Bump deliberately when the pin moves. */
export const EXPECTED_SHA256 = "b5144530ac50cf5a4543d356a6b316f364612c3fdb9abdc68cd9175f66951184";

let cached: object | undefined;

export function loadThemeSchema(): object {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "schema", "theme-v3.json"));
  const actual = createHash("sha256").update(raw).digest("hex");
  if (actual !== EXPECTED_SHA256) {
    throw new Error(
      `Vendored theme.json schema SHA-256 mismatch (expected ${EXPECTED_SHA256}, got ${actual}). ` +
        "The pinned schema may have been substituted or tampered with.",
    );
  }
  cached = JSON.parse(raw.toString("utf8")) as object;
  return cached;
}
