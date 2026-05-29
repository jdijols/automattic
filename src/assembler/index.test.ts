// @vitest-environment jsdom
//
// Assembler integration tests (U9). These exercise the whole IR → file-tree → zip
// path against the real positive-corpus fixtures, and pin the two properties the
// per-module unit tests cannot: byte-reproducibility (a committed golden .zip) and
// the end-to-end injection defenses applied in concert.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { irSchema, type IR } from "../ir/schema";
import { assembleThemeFiles, assembleThemeZip, AssemblyError } from "./index";

// Vitest runs with the repo root as cwd; resolve fixtures/goldens from there
// rather than import.meta.url (which is an http:// URL under the jsdom env).
const repo = (...segments: string[]): string => resolve(process.cwd(), ...segments);

/** Parse a positive fixture's `input` into a canonical (defaults-applied) IR. */
function loadIR(name: "blog" | "portfolio" | "landing"): IR {
  const fixture = JSON.parse(
    readFileSync(repo("fixtures", "positive", name, `${name}.json`), "utf8"),
  ) as { input: unknown };
  return irSchema.parse(fixture.input);
}

function fileMap(files: { path: string; content: string }[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

describe("assembleThemeFiles — minimum valid theme", () => {
  it("produces style.css + templates/index.html + theme.json for a positive IR", () => {
    const files = fileMap(assembleThemeFiles(loadIR("blog")));
    expect(files.has("style.css")).toBe(true);
    expect(files.has("templates/index.html")).toBe(true);
    expect(files.has("theme.json")).toBe(true);
    expect(files.get("style.css")).toContain("Theme Name: Aurora");
    expect(JSON.parse(files.get("theme.json")!).version).toBe(3);
  });

  it("guarantees templates/index.html even when the IR declares only a 'home' template", () => {
    const files = fileMap(assembleThemeFiles(loadIR("landing")));
    expect(files.has("templates/home.html")).toBe(true);
    expect(files.has("templates/index.html")).toBe(true);
  });

  it("does NOT serve a 404 template as the home page (uses the minimal index fallback)", () => {
    const ir = loadIR("blog");
    const only404: IR = {
      ...ir,
      regions: [
        {
          kind: "template",
          name: "404",
          content: [{ block: "core/heading", nodeKind: "static", text: "Lost in space" }],
        },
      ],
    };
    const files = fileMap(assembleThemeFiles(only404));
    expect(files.get("templates/404.html")).toContain("Lost in space");
    // index.html falls back to the minimal posts index, NOT the 404 content.
    expect(files.get("templates/index.html")).toContain("wp:query");
    expect(files.get("templates/index.html")).not.toContain("Lost in space");
  });
});

describe("assembleThemeFiles — fail-closed on duplicate paths", () => {
  it("throws when two regions map to the same file (non-unique regions)", () => {
    const ir = loadIR("blog");
    const dup: IR = {
      ...ir,
      regions: [
        { kind: "template", name: "index", content: [{ block: "core/paragraph", nodeKind: "static", text: "A" }] },
        { kind: "template", name: "index", content: [{ block: "core/paragraph", nodeKind: "static", text: "B" }] },
      ],
    };
    expect(() => assembleThemeFiles(dup)).toThrow(/duplicate region/i);
  });
});

describe("assembleThemeFiles — pattern expansion + nav provisioning", () => {
  it("emits a patterns/*.php file and references it via a wp:pattern block", () => {
    const files = fileMap(assembleThemeFiles(loadIR("portfolio")));
    expect(files.has("patterns/site-footer.php")).toBe(true);
    expect(files.get("parts/footer.html")).toContain('wp:pattern {"slug":"');
    // PHP file: header carries no interpolated user data; body is block markup.
    const php = files.get("patterns/site-footer.php")!;
    expect(php.startsWith("<?php")).toBe(true);
    expect(php).toContain("Slug: lumen-portfolio/site-footer");
  });

  it("provisions navigation inside the resolved footer pattern (blob-aware path)", () => {
    const files = fileMap(assembleThemeFiles(loadIR("portfolio")));
    // The footer's nav lives inside the pattern blob; provisioning gave it a
    // page-list so it renders non-empty with no database menu.
    expect(files.get("patterns/site-footer.php")).toContain("wp:page-list");
  });

  it("provisions a free-tree navigation node (blog footer, IR-node path)", () => {
    const files = fileMap(assembleThemeFiles(loadIR("blog")));
    expect(files.get("parts/footer.html")).toContain("wp:page-list");
    expect(files.get("parts/footer.html")).not.toContain('"ref"');
  });
});

describe("assembleThemeFiles — injection defenses (end to end)", () => {
  it("strips a style.css-breaking title before writing the header", () => {
    const ir = loadIR("blog");
    const evil: IR = { ...ir, theme: { ...ir.theme, title: "Evil */ body{} /*" } };
    const files = fileMap(assembleThemeFiles(evil));
    // Exactly one comment close survives — the real terminator.
    expect(files.get("style.css")!.match(/\*\//g)).toHaveLength(1);
  });

  it("rejects a path-traversal theme slug before any path is built (zip-slip)", () => {
    const ir = loadIR("blog");
    // Bypass the schema (which would also reject it) to prove the assembler's own
    // guard fires.
    const evil = { ...ir, theme: { ...ir.theme, slug: "../../wp-config" } } as unknown as IR;
    expect(() => assembleThemeFiles(evil)).toThrow();
  });

  it("never emits a raw Custom HTML block (layer 4 is wired and fail-closed)", () => {
    // A clean IR assembles without an AssemblyError; the layer-4 wiring is proven
    // here by the absence of wp:html across the whole tree.
    const files = assembleThemeFiles(loadIR("portfolio"));
    for (const f of files) {
      expect(f.content.toLowerCase()).not.toMatch(/<!--\s*wp:(core\/)?html/);
    }
  });
});

describe("assembleThemeZip — byte reproducibility", () => {
  function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return Buffer.from(a).equals(Buffer.from(b));
  }

  it("produces identical bytes for the same IR twice", async () => {
    const a = await assembleThemeZip(loadIR("blog"));
    const b = await assembleThemeZip(loadIR("blog"));
    expect(bytesEqual(a, b)).toBe(true);
  });

  it("matches the committed golden .zip byte-for-byte (cross-environment guard)", async () => {
    const golden = new Uint8Array(readFileSync(repo("src", "assembler", "golden", "aurora-blog.zip")));
    const actual = await assembleThemeZip(loadIR("blog"));
    expect(bytesEqual(actual, golden)).toBe(true);
  });

  it("asserts the pinned @wordpress/blocks version that defines the canonical bytes", () => {
    // The golden bytes are only valid for the exact serializer that produced them.
    // A lockfile bump that changed @wordpress/blocks would change canonical bytes;
    // this makes that fail loudly rather than silently regenerating the golden.
    const rootPkg = JSON.parse(readFileSync(repo("package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const pinned = rootPkg.dependencies["@wordpress/blocks"];
    expect(pinned).toBe("15.20.0"); // exact pin, no caret/tilde
    const installed = JSON.parse(
      readFileSync(repo("node_modules", "@wordpress", "blocks", "package.json"), "utf8"),
    ) as { version: string };
    expect(installed.version).toBe(pinned);
  });
});

describe("AssemblyError", () => {
  it("is the typed error carrying layer-4 findings", () => {
    const err = new AssemblyError([
      {
        code: "RAW_HTML_DETECTED",
        layer: "assembled-artifact",
        path: "templates/index.html",
        message: "x",
        invariant: "wp-html",
      },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.errors).toHaveLength(1);
  });
});
