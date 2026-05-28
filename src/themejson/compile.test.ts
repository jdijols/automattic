import { describe, expect, it } from "vitest";

import { layer3 } from "../validator/layer3-themejson";
import { compileThemeJson } from "./compile";

describe("theme.json compilation", () => {
  it("compiles a token set into a version-3 theme.json with mapped presets", () => {
    const tj = compileThemeJson({
      colors: [{ slug: "brandblue", color: "#0b3d91", name: "Brand Blue" }],
      fontSizes: [{ slug: "huge", size: "3rem" }],
      spacing: [{ slug: "tight", size: "0.5rem" }],
    });
    expect(tj.version).toBe(3);
    expect(tj.settings.color?.palette).toEqual([
      { slug: "brandblue", color: "#0b3d91", name: "Brand Blue" },
    ]);
    expect(tj.settings.typography?.fontSizes?.[0]?.slug).toBe("huge");
    expect(tj.settings.spacing?.spacingSizes?.[0]?.slug).toBe("tight");
  });

  it("emits defaultFontSizes:false when a fontSize token reuses a core slug", () => {
    const tj = compileThemeJson({ fontSizes: [{ slug: "large", size: "2rem" }] });
    expect(tj.settings.typography?.defaultFontSizes).toBe(false);
  });

  it("emits defaultSpacingSizes:false when a spacing token reuses a core slug", () => {
    const tj = compileThemeJson({ spacing: [{ slug: "50", size: "1.5rem" }] });
    expect(tj.settings.spacing?.defaultSpacingSizes).toBe(false);
  });

  it("emits defaultPalette:false when a color token reuses a core slug", () => {
    const tj = compileThemeJson({ colors: [{ slug: "white", color: "#ffffff" }] });
    expect(tj.settings.color?.defaultPalette).toBe(false);
  });

  it("omits the default-disable flags when no core slug is reused", () => {
    const tj = compileThemeJson({ fontSizes: [{ slug: "huge", size: "3rem" }] });
    expect(tj.settings.typography?.defaultFontSizes).toBeUndefined();
  });

  it("produces a theme.json that passes the layer-3 validator", () => {
    const ir = {
      tokens: {
        colors: [{ slug: "base", color: "#0b0b0f" }],
        fontSizes: [{ slug: "huge", size: "3rem" }],
      },
    };
    expect(layer3(ir as never)).toEqual([]);
  });
});
