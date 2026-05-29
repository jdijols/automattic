// Pattern blob integrity manifest tests. Asserts the committed SHA-256 manifest
// matches the on-disk seed blobs (the drift guard the plan requires), and that
// tampering is detectable. No DOM needed — hashing is a pure byte operation.
import { describe, expect, it } from "vitest";

import {
  assertPatternManifest,
  expectedHash,
  hashBlob,
  recomputeManifest,
  verifyPatternManifest,
} from "./pattern-manifest";
import { loadPatternBlob, PATTERN_SLUGS } from "./pattern-library";

describe("pattern blob SHA-256 manifest", () => {
  it("matches every committed hash against the on-disk blob (drift guard)", () => {
    expect(verifyPatternManifest()).toEqual([]);
  });

  it("assertPatternManifest does not throw when blobs are intact", () => {
    expect(() => assertPatternManifest()).not.toThrow();
  });

  it("has a committed hash for every seed pattern", () => {
    for (const slug of PATTERN_SLUGS) {
      expect(expectedHash(slug), `missing manifest entry for ${slug}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("recomputeManifest reproduces the committed hashes (regen is a no-op when intact)", () => {
    const recomputed = recomputeManifest();
    for (const slug of PATTERN_SLUGS) {
      expect(recomputed[slug]).toBe(expectedHash(slug));
    }
  });

  it("detects a tampered blob (hash changes for any byte edit)", () => {
    const original = loadPatternBlob("hero-cover");
    const tampered = original + "\n<!-- a single appended byte changes the hash -->";
    expect(hashBlob(tampered)).not.toBe(expectedHash("hero-cover"));
  });
});
