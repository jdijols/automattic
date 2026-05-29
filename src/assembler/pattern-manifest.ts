// SHA-256 integrity manifest for the seed pattern blobs (origin §6.4 security
// note). The pattern.html blobs are trusted-by-assumption inputs to the
// substitution path (patterns.ts), so a committed hash manifest makes any change
// to a blob visible in a PR — pairing with the pre-substitution blob-integrity
// scan (which catches raw wp:html / PHP in a blob) to give defense in depth: the
// scan catches the dangerous CONTENT, the manifest catches the FACT of any edit.
//
// The manifest itself lives in pattern-blobs.sha256.json (committed). CI (U11)
// and the pipeline re-verify it; pattern-manifest.test.ts asserts the on-disk
// blobs match. Verification is byte-exact (no normalization) — the point is to
// surface ANY drift, intentional or not, for human review.
import { createHash } from "node:crypto";

import { loadPatternBlob, PATTERN_SLUGS } from "./pattern-library";
// Inline JSON import — resolved at build by the bundler (tsconfig resolveJsonModule).
import manifest from "./pattern-blobs.sha256.json";

/** SHA-256 (hex) of a pattern blob's exact bytes. */
export function hashBlob(blob: string): string {
  return createHash("sha256").update(blob, "utf8").digest("hex");
}

/** The committed expected hash for a slug, or undefined if unmanifested. */
export function expectedHash(slug: string): string | undefined {
  const value = (manifest as Record<string, unknown>)[slug];
  return typeof value === "string" ? value : undefined;
}

export interface ManifestMismatch {
  slug: string;
  expected: string | undefined;
  actual: string;
}

/**
 * Verify every seed blob against the committed manifest. Returns the list of
 * mismatches (empty = all blobs are intact). Pure: callers (tests, the assembler
 * pipeline, CI) decide how to react.
 */
export function verifyPatternManifest(): ManifestMismatch[] {
  const mismatches: ManifestMismatch[] = [];
  for (const slug of PATTERN_SLUGS) {
    const actual = hashBlob(loadPatternBlob(slug));
    const expected = expectedHash(slug);
    if (expected !== actual) {
      mismatches.push({ slug, expected, actual });
    }
  }
  return mismatches;
}

/**
 * Throw if any seed blob has drifted from the committed manifest. Use this as a
 * hard gate at assembly time so a tampered blob cannot silently flow into a
 * generated theme.
 */
export function assertPatternManifest(): void {
  const mismatches = verifyPatternManifest();
  if (mismatches.length > 0) {
    const detail = mismatches
      .map((m) => `  ${m.slug}: expected ${m.expected ?? "(unmanifested)"}, got ${m.actual}`)
      .join("\n");
    throw new Error(
      `Pattern blob integrity manifest mismatch — a seed blob changed without updating pattern-blobs.sha256.json:\n${detail}`,
    );
  }
}

/**
 * Recompute the manifest from the current blobs. NOT used at runtime — exposed so
 * a deliberate pattern edit can regenerate the committed JSON (and surface the
 * diff for review) rather than hand-editing hashes.
 */
export function recomputeManifest(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slug of PATTERN_SLUGS) {
    out[slug] = hashBlob(loadPatternBlob(slug));
  }
  return out;
}
