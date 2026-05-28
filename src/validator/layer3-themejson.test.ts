import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EXPECTED_SHA256 } from "../themejson/load-schema";
import { layer3, validateThemeJson, validateTokenValues } from "./layer3-themejson";

const schemaPath = new URL("../themejson/schema/theme-v3.json", import.meta.url);

describe("vendored theme.json schema integrity", () => {
  it("matches the committed SHA-256 (pinned, tamper-evident)", () => {
    const actual = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
    expect(actual).toBe(EXPECTED_SHA256);
  });
});

describe("layer 3 — theme.json schema validation (AJV)", () => {
  it("passes a valid compiled theme.json", () => {
    expect(validateThemeJson({ version: 3, settings: { color: { palette: [] } } })).toEqual([]);
  });

  it("rejects an unknown top-level key", () => {
    const errors = validateThemeJson({ version: 3, bogusTopLevel: true });
    expect(errors.some((e) => e.code === "THEME_JSON_INVALID")).toBe(true);
    expect(errors[0]?.layer).toBe("theme-json");
    expect(errors[0]?.invariant).toBe("invalid-theme-json");
  });

  it("rejects version 2 against the v3-pinned schema (the version-pair trap)", () => {
    expect(validateThemeJson({ version: 2, settings: {} }).some((e) => e.code === "THEME_JSON_INVALID")).toBe(
      true,
    );
  });

  it("rejects a setting-key typo", () => {
    expect(
      validateThemeJson({ version: 3, settings: {}, colour: {} }).some((e) => e.code === "THEME_JSON_INVALID"),
    ).toBe(true);
  });

  it("rejects a core-slug reuse without the default-disable flag", () => {
    const reuseNoFlag = {
      version: 3,
      settings: { typography: { fontSizes: [{ slug: "large", size: "2rem", name: "Large" }] } },
    };
    expect(validateThemeJson(reuseNoFlag).some((e) => e.code === "THEME_JSON_INVALID")).toBe(true);
  });

  it("does not leak raw AJV error objects in the message", () => {
    const errors = validateThemeJson({ version: 3, bogusTopLevel: true });
    expect(typeof errors[0]?.message).toBe("string");
    expect(errors[0]?.message).not.toContain("schemaPath");
    expect(errors[0]?.message).not.toContain("keyword");
  });
});

describe("layer 3 — token value validation (CSS-injection defense)", () => {
  it("accepts valid hex colors and number+unit sizes", () => {
    expect(
      validateTokenValues({
        colors: [{ slug: "a", color: "#0b0b0f" }, { slug: "b", color: "#fff" }],
        fontSizes: [{ slug: "m", size: "1.125rem" }],
        spacing: [{ slug: "s", size: "clamp(1rem, 2vw, 3rem)" }],
      }),
    ).toEqual([]);
  });

  it("rejects a CSS-injection color value", () => {
    const errors = validateTokenValues({ colors: [{ slug: "x", color: "#f00; } body{ background:url(x) }" }] });
    expect(errors.some((e) => e.code === "TOKEN_VALUE_INVALID")).toBe(true);
    expect(errors[0]?.invariant).toBe("invalid-theme-json");
  });

  it("rejects a malformed (non-hex) color value", () => {
    expect(
      validateTokenValues({ colors: [{ slug: "x", color: "not-a-color" }] }).some(
        (e) => e.code === "TOKEN_VALUE_INVALID",
      ),
    ).toBe(true);
  });

  it("rejects a size value carrying a CSS-injection breakout", () => {
    expect(
      validateTokenValues({ spacing: [{ slug: "x", size: "1rem; } body { display:none }" }] }).some(
        (e) => e.code === "TOKEN_VALUE_INVALID",
      ),
    ).toBe(true);
  });

  it("rejects dangerous CSS functions and comment delimiters in size values", () => {
    for (const size of [
      "expression(alert(1))",
      "url(x)",
      "var(--x)",
      "attr(data-x)",
      "image-set(a)",
      "calc(1rem)/*",
      "/* x */1rem",
    ]) {
      expect(
        validateTokenValues({ spacing: [{ slug: "x", size }] }).some((e) => e.code === "TOKEN_VALUE_INVALID"),
        size,
      ).toBe(true);
    }
  });

  it("still accepts legitimate calc/clamp/min/max sizes", () => {
    for (const size of ["calc(100% - 2rem)", "clamp(1rem, 2vw, 3rem)", "min(2rem, 5vw)", "1.5rem"]) {
      expect(validateTokenValues({ spacing: [{ slug: "x", size }] }), size).toEqual([]);
    }
  });
});

describe("layer 3 — color core-slug reuse (parity with fontSizes/spacing)", () => {
  it("rejects a color preset reusing a core slug without defaultPalette:false", () => {
    const reuse = {
      version: 3,
      settings: { color: { palette: [{ slug: "white", color: "#ffffff", name: "White" }] } },
    };
    expect(validateThemeJson(reuse).some((e) => e.code === "THEME_JSON_INVALID")).toBe(true);
  });

  it("accepts the same palette once defaultPalette:false is set", () => {
    const ok = {
      version: 3,
      settings: { color: { defaultPalette: false, palette: [{ slug: "white", color: "#ffffff", name: "White" }] } },
    };
    expect(validateThemeJson(ok)).toEqual([]);
  });
});

describe("layer 3 — orchestrated over an IR", () => {
  it("returns no errors for a valid token set", () => {
    expect(
      layer3({ tokens: { colors: [{ slug: "base", color: "#0b0b0f" }] } } as never),
    ).toEqual([]);
  });

  it("fails fast on an unsafe token value (short-circuits before compile, never throws)", () => {
    let errors: ReturnType<typeof layer3> | undefined;
    expect(() => {
      errors = layer3({ tokens: { colors: [{ slug: "x", color: "javascript:alert(1)" }] } } as never);
    }).not.toThrow();
    expect(errors!.some((e) => e.code === "TOKEN_VALUE_INVALID")).toBe(true);
    // Short-circuit: no compiled-schema error is appended for the same defect.
    expect(errors!.every((e) => e.code === "TOKEN_VALUE_INVALID")).toBe(true);
  });
});
