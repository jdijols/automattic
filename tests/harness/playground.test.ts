// @vitest-environment jsdom
//
// U10 — WordPress Playground install/activate gate, integration tests (origin
// §7.2). Boots ONE headless WP 6.6 / PHP 8.2 and exercises every positive
// archetype plus a failing case per assertion, proving each assertion BITES (a
// gate that never fails proves nothing). The slow gate: run via `npm run
// test:slow`, excluded from the fast unit gate.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assembleThemeZip } from "../../src/assembler/index";
import { packZip } from "../../src/assembler/zip";
import type { AssembledFile } from "../../src/validator/layer4-scan";
import { irSchema, type IR } from "../../src/ir/schema";
import {
  assertActiveTheme,
  bootPlayground,
  installTheme,
  type Playground,
} from "../../src/harness/run";

const repo = (...s: string[]): string => resolve(process.cwd(), ...s);

function loadIR(name: "blog" | "portfolio" | "landing"): IR {
  const fx = JSON.parse(readFileSync(repo("fixtures", "positive", name, `${name}.json`), "utf8")) as {
    input: unknown;
  };
  return irSchema.parse(fx.input);
}

/** A minimal installable+activatable theme, with per-path overrides for biting cases. */
function minimalTheme(slug: string, overrides: AssembledFile[] = []): AssembledFile[] {
  const base: AssembledFile[] = [
    { path: "style.css", content: `/*\nTheme Name: ${slug}\nText Domain: ${slug}\n*/\n` },
    { path: "templates/index.html", content: `<!-- wp:paragraph -->\n<p>Home</p>\n<!-- /wp:paragraph -->\n` },
    { path: "theme.json", content: `{\n  "version": 3\n}\n` },
  ];
  const byPath = new Map(base.map((f) => [f.path, f]));
  for (const o of overrides) byPath.set(o.path, o);
  return [...byPath.values()];
}

let pg: Playground;

beforeAll(async () => {
  pg = await bootPlayground();
}, 180_000);

afterAll(async () => {
  await pg?.dispose();
});

/** Install a zip + run the gate, returning the structured result. */
async function gate(zip: Uint8Array, slug: string) {
  await installTheme(pg, zip, slug);
  return assertActiveTheme(pg, slug);
}

describe("positive archetypes install, activate, and pass all four assertions", () => {
  it("blog (free-tree footer nav)", async () => {
    const result = await gate(await assembleThemeZip(loadIR("blog")), "aurora-blog");
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("portfolio (nav ONLY from the site-footer pattern blob — blob-aware path)", async () => {
    const result = await gate(await assembleThemeZip(loadIR("portfolio")), "lumen-portfolio");
    expect(result.failures).toEqual([]);
    // The defining U10 case: the nav lives only inside the footer pattern blob,
    // yet renders non-empty — no navigation failure.
    expect(result.failures.filter((f) => f.check === "navigation")).toEqual([]);
  });

  it("landing (home template synthesized to index + footer-pattern nav)", async () => {
    const result = await gate(await assembleThemeZip(loadIR("landing")), "ascent-landing");
    expect(result.failures).toEqual([]);
  });
});

describe("each assertion bites", () => {
  it("assertion 2: an unregistered/hallucinated block surfaces", async () => {
    const zip = await packZip(
      minimalTheme("bite-unregistered", [
        {
          path: "templates/index.html",
          content: `<!-- wp:core/totally-made-up -->\n<div></div>\n<!-- /wp:core/totally-made-up -->\n`,
        },
      ]),
      "bite-unregistered",
    );
    const result = await gate(zip, "bite-unregistered");
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.check === "block-resolution")).toBe(true);
  });

  it("assertion 2: an undelimited raw-HTML chunk is caught (the null-chunk backstop)", async () => {
    const zip = await packZip(
      minimalTheme("bite-undelimited", [
        { path: "parts/footer.html", content: `<div class="raw">no block delimiter here</div>\n` },
      ]),
      "bite-undelimited",
    );
    const result = await gate(zip, "bite-undelimited");
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.check === "block-resolution" && /undelimited/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("assertion 3: a theme.json key WordPress drops is caught", async () => {
    const zip = await packZip(
      minimalTheme("bite-droppedkey", [
        {
          path: "theme.json",
          content: `{\n  "version": 3,\n  "settings": { "color": { "palette": [] }, "bogusUnknownKey": true }\n}\n`,
        },
      ]),
      "bite-droppedkey",
    );
    const result = await gate(zip, "bite-droppedkey");
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.check === "theme-json-keys")).toBe(true);
  });

  it("assertion 4: a navigation that renders empty fails", async () => {
    const zip = await packZip(
      minimalTheme("bite-emptynav", [
        {
          path: "parts/footer.html",
          // A ref to a non-existent menu entity, no inner fallback → renders empty.
          content: `<!-- wp:navigation {"ref":999999,"overlayMenu":"never"} /-->\n`,
        },
      ]),
      "bite-emptynav",
    );
    const result = await gate(zip, "bite-emptynav");
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.check === "navigation")).toBe(true);
  });
});
