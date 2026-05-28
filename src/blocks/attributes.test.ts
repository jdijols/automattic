import { describe, expect, it } from "vitest";

import { ALLOWLIST } from "./allowlist";
import { getCoreAttributeKeys } from "./block-json";
import { isSafeUrl, validateAttributes } from "./attributes";

describe("block.json extraction", () => {
  it("loads a key/type surface for every allowlist block", () => {
    for (const block of ALLOWLIST) {
      const keys = getCoreAttributeKeys(block);
      expect(keys, `no block.json attribute surface for ${block}`).toBeInstanceOf(Set);
    }
  });

  it("exposes the documented heading keys (level present, no range in block.json)", () => {
    const keys = getCoreAttributeKeys("core/heading");
    expect(keys.has("level")).toBe(true);
    expect(keys.has("content")).toBe(true);
  });
});

describe("attribute value-range overlay", () => {
  it("accepts heading levels 1..6 and rejects out-of-range", () => {
    expect(validateAttributes("core/heading", { level: 2 })).toEqual([]);
    expect(validateAttributes("core/heading", { level: 1 })).toEqual([]);
    expect(validateAttributes("core/heading", { level: 6 })).toEqual([]);

    const seven = validateAttributes("core/heading", { level: 7 });
    expect(seven).toHaveLength(1);
    expect(seven[0]?.kind).toBe("ATTRIBUTE_OUT_OF_RANGE");
    expect(seven[0]?.attribute).toBe("level");

    expect(validateAttributes("core/heading", { level: 0 })[0]?.kind).toBe(
      "ATTRIBUTE_OUT_OF_RANGE",
    );
  });

  it("bounds cover.dimRatio to 0..100", () => {
    expect(validateAttributes("core/cover", { dimRatio: 50 })).toEqual([]);
    expect(validateAttributes("core/cover", { dimRatio: 0 })).toEqual([]);
    expect(validateAttributes("core/cover", { dimRatio: 100 })).toEqual([]);
    expect(validateAttributes("core/cover", { dimRatio: 150 })[0]?.kind).toBe(
      "ATTRIBUTE_OUT_OF_RANGE",
    );
    expect(validateAttributes("core/cover", { dimRatio: -1 })[0]?.kind).toBe(
      "ATTRIBUTE_OUT_OF_RANGE",
    );
  });

  it("restricts columns.align to wide/full or absent", () => {
    expect(validateAttributes("core/columns", { align: "wide" })).toEqual([]);
    expect(validateAttributes("core/columns", { align: "full" })).toEqual([]);
    expect(validateAttributes("core/columns", {})).toEqual([]);
    expect(validateAttributes("core/columns", { align: "left" })[0]?.kind).toBe(
      "ATTRIBUTE_OUT_OF_RANGE",
    );
  });
});

describe("URL safe-scheme overlay", () => {
  it("accepts the safe schemes and relative URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("mailto:hi@example.com")).toBe(true);
    expect(isSafeUrl("tel:+15551234")).toBe(true);
    expect(isSafeUrl("/about")).toBe(true);
    expect(isSafeUrl("#section")).toBe(true);
  });

  it("rejects javascript:, data:, and other dangerous schemes", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("defeats whitespace/control-char scheme obfuscation", () => {
    expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
    expect(isSafeUrl("\x00javascript:alert(1)")).toBe(false);
  });

  it("defeats Unicode whitespace / zero-width / BOM scheme obfuscation", () => {
    expect(isSafeUrl(" javascript:alert(1)")).toBe(false); // no-break space
    expect(isSafeUrl("java​script:alert(1)")).toBe(false); // zero-width space
    expect(isSafeUrl("﻿javascript:alert(1)")).toBe(false); // BOM
    expect(isSafeUrl("　javascript:alert(1)")).toBe(false); // ideographic space
  });

  it("flags an unsafe URL on a URL-valued block attribute", () => {
    expect(validateAttributes("core/button", { url: "https://example.com" })).toEqual([]);
    expect(validateAttributes("core/button", { url: "javascript:alert(1)" })[0]?.kind).toBe(
      "UNSAFE_URL",
    );
    expect(validateAttributes("core/social-link", { url: "tel:+1", service: "x" })).toEqual([]);
    expect(validateAttributes("core/social-link", { url: "data:x" })[0]?.kind).toBe("UNSAFE_URL");
  });
});

describe("unknown attribute keys", () => {
  it("rejects an attribute key that is neither block-specific nor a common support", () => {
    const violations = validateAttributes("core/heading", { notARealAttribute: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("UNKNOWN_ATTRIBUTE");
    expect(violations[0]?.attribute).toBe("notARealAttribute");
  });

  it("accepts supports-derived attributes used by the seed patterns", () => {
    // These come from block `supports`, not block.json `attributes`, but are
    // legitimate WordPress attribute keys and must not be rejected.
    expect(
      validateAttributes("core/group", {
        align: "full",
        layout: { type: "constrained" },
        style: { spacing: { padding: "var:preset|spacing|50" } },
        backgroundColor: "base",
        textColor: "contrast",
      }),
    ).toEqual([]);
    expect(validateAttributes("core/heading", { textAlign: "center", fontSize: "x-large" })).toEqual(
      [],
    );
  });
});
