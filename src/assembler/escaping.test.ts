// Per-output-context injection-defense tests (origin §6.4). Each case is a
// concrete exploit, not a wishlist item: a style.css header break, a PHP-RCE
// delimiter, and a zip-slip path-traversal slug. The defenses live at the
// assembler boundary so a malicious AI/user string cannot reach an output
// context where it would be interpreted as code or structure.
import { describe, expect, it } from "vitest";

import {
  assertSafeRelPath,
  assertSafeSlug,
  buildEntryPath,
  InjectionDefenseError,
  sanitizeHeaderValue,
} from "./escaping";

describe("sanitizeHeaderValue (style.css header context)", () => {
  it("removes a '*/' comment-close sequence that would break out of the header block", () => {
    const out = sanitizeHeaderValue("Evil */ body{display:none}");
    expect(out).not.toContain("*/");
  });

  it("removes CR and LF so a value cannot inject a second header line", () => {
    const out = sanitizeHeaderValue("Aurora\r\nVersion: 9.9.9");
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("leaves a clean value unchanged", () => {
    expect(sanitizeHeaderValue("Aurora — Essays on craft")).toBe("Aurora — Essays on craft");
  });
});

describe("assertSafeSlug (zip-slip / path-construction context)", () => {
  it("accepts a valid theme slug", () => {
    expect(() => assertSafeSlug("aurora-blog", "theme.slug")).not.toThrow();
  });

  it("rejects a path-traversal slug before it can reach path construction", () => {
    expect(() => assertSafeSlug("../../wp-config", "theme.slug")).toThrow(InjectionDefenseError);
  });

  it("rejects an uppercase / out-of-charset slug", () => {
    expect(() => assertSafeSlug("Aurora_Blog", "theme.slug")).toThrow(InjectionDefenseError);
  });
});

describe("assertSafeRelPath (zip entry path)", () => {
  it("accepts a literal-prefixed relative path", () => {
    expect(() => assertSafeRelPath("templates/index.html")).not.toThrow();
  });

  it("rejects a parent-directory traversal", () => {
    expect(() => assertSafeRelPath("../evil.html")).toThrow(InjectionDefenseError);
    expect(() => assertSafeRelPath("patterns/../../evil.php")).toThrow(InjectionDefenseError);
  });

  it("rejects an absolute path and a backslash path", () => {
    expect(() => assertSafeRelPath("/etc/passwd")).toThrow(InjectionDefenseError);
    expect(() => assertSafeRelPath("patterns\\evil.php")).toThrow(InjectionDefenseError);
  });
});

describe("buildEntryPath", () => {
  it("joins a literal prefix with a validated slug segment", () => {
    expect(buildEntryPath("patterns", "site-footer.php")).toBe("patterns/site-footer.php");
  });

  it("refuses to build a path from a traversal segment", () => {
    expect(() => buildEntryPath("patterns", "../evil.php")).toThrow(InjectionDefenseError);
  });
});
