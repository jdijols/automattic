// T4-U3 — the pure request-body builder for the input form. The form holds every
// criteria field as a string (controlled inputs); this maps that flat form state to
// the POST body the route expects, PRUNING empty fields so the strict
// structuredCriteriaSchema never sees an empty string (an empty hex "" would fail
// the HEX regex → a spurious 400 invalid_criteria). Tested here so the pruning is
// guaranteed before the React layer ever runs.
import { describe, expect, it } from "vitest";

import { type GenerateForm, buildGenerateBody, emptyForm } from "../../app/lib/generate-request";

const base = (over: Partial<GenerateForm>): GenerateForm => ({ ...emptyForm(), ...over });

describe("buildGenerateBody (T4-U3)", () => {
  it("sends only the description when no criteria are filled — no empty criteria object", () => {
    const body = buildGenerateBody(base({ description: "A clean blog." }));
    expect(body.userDescription).toBe("A clean blog.");
    expect(body.criteria).toBeUndefined();
  });

  it("trims the description", () => {
    expect(buildGenerateBody(base({ description: "  hello  " })).userDescription).toBe("hello");
  });

  it("includes only the non-empty palette fields, omitting blanks", () => {
    const body = buildGenerateBody(
      base({ description: "x", criteria: { ...emptyForm().criteria, primary: "#3858E9", text: "" } }),
    );
    expect(body.criteria).toEqual({ palette: { primary: "#3858E9" } });
  });

  it("omits the palette object entirely when every color is blank", () => {
    const body = buildGenerateBody(
      base({ description: "x", criteria: { ...emptyForm().criteria, primary: "", secondary: "  " } }),
    );
    expect(body.criteria).toBeUndefined();
  });

  it("includes typography only for non-empty fonts", () => {
    const body = buildGenerateBody(
      base({ description: "x", criteria: { ...emptyForm().criteria, headingFont: "Inter", bodyFont: "" } }),
    );
    expect(body.criteria).toEqual({ typography: { headingFont: "Inter" } });
  });

  it("includes siteType only when chosen, and composes palette + typography + siteType together", () => {
    const body = buildGenerateBody(
      base({
        description: "x",
        criteria: {
          siteType: "portfolio",
          primary: "#111111",
          secondary: "",
          background: "#ffffff",
          text: "",
          headingFont: "Georgia",
          bodyFont: "",
        },
      }),
    );
    expect(body.criteria).toEqual({
      siteType: "portfolio",
      palette: { primary: "#111111", background: "#ffffff" },
      typography: { headingFont: "Georgia" },
    });
  });

  it("trims whitespace around hex/font values before sending", () => {
    const body = buildGenerateBody(
      base({ description: "x", criteria: { ...emptyForm().criteria, primary: "  #abc  ", headingFont: "  Inter " } }),
    );
    expect(body.criteria).toEqual({ palette: { primary: "#abc" }, typography: { headingFont: "Inter" } });
  });
});
