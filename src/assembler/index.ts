// The deterministic assembler (U9). Turns a validated IR into a byte-reproducible
// theme .zip, applying every per-output-context injection defense and finishing
// with the layer-4 byte scan of the assembled artifact. This is the security
// boundary between "validated structure" and "shipped bytes", so it is
// fail-closed: a layer-4 finding aborts assembly rather than emitting the file.
//
// Pipeline order (each step's rationale lives in its own module):
//   0. assertPatternManifest() — FIRST. A seed pattern blob that drifted from its
//      committed SHA-256 (a tampered/compromised pattern) must stop assembly
//      before any of its bytes flow into the artifact (U8 security review).
//   1. style.css + theme.json — the theme identity + design tokens.
//   2. Per region → templates/*.html or parts/*.html, composing the U8 serializer
//      (free-tree blockNodes) with patternRef expansion (patterns/*.php + a
//      wp:pattern reference).
//   3. Navigation provisioning on every region markup AND every pattern body, so
//      a core/navigation renders non-empty with no database menu (blob-aware).
//   4. Guarantee templates/index.html exists — the only file that makes
//      wp_is_block_theme() true.
//   5. Layer-4 scan of the whole file tree; throw on any finding.
//   6. Deterministic packaging (zip.ts) under a single <slug>/ root.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compileThemeJson } from "../themejson/compile";
import type { IR, IRNode, PatternRef } from "../ir/types";
import { scanAssembledArtifact, type AssembledFile } from "../validator/layer4-scan";
import type { ValidationError } from "../validator/errors";
import { assertSafeSlug, sanitizeHeaderValue } from "./escaping";
import { getPatternMeta } from "./pattern-library";
import { assertPatternManifest } from "./pattern-manifest";
import { substitutePattern } from "./patterns";
import { provisionNavigationMarkup } from "./provisioning";
import { serializeBlockNode, serializeNodes } from "./serializer";
import { buildStyleCss } from "./style-css";
import { packZip } from "./zip";

/** Raised when the assembled artifact fails the layer-4 scan. Carries the findings. */
export class AssemblyError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(
      `Theme assembly failed the layer-4 scan with ${errors.length} finding(s): ` +
        errors.map((e) => `${e.code} @ ${e.path}`).join("; "),
    );
    this.name = "AssemblyError";
  }
}

/** Narrow an IR content node to a patternRef (vs a blockNode). */
function isPatternRef(node: IRNode): node is PatternRef {
  return "pattern" in node;
}

/** Serialize a compiled theme.json object to deterministic, LF-terminated JSON. */
function stringifyThemeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * Build a `patterns/*.php` file body. Only the Title (trusted pattern metadata)
 * and Slug (validated theme + file slugs) are interpolated, and both go through
 * the header sanitizer — NO user/AI data is ever interpolated as PHP. The block
 * markup body has already passed patterns.ts (which rejects PHP delimiters), so
 * the body cannot reopen the PHP context. `Inserter: no` keeps these
 * theme-internal patterns out of the editor inserter.
 */
function buildPatternPhp(title: string, registeredSlug: string, markup: string): string {
  const header = [
    "<?php",
    "/**",
    ` * Title: ${sanitizeHeaderValue(title)}`,
    ` * Slug: ${registeredSlug}`,
    " * Inserter: no",
    " */",
    "?>",
  ].join("\n");
  const body = markup.endsWith("\n") ? markup : markup + "\n";
  return `${header}\n${body}`;
}

/**
 * Resolves patternRef nodes to registered theme patterns. Deduplicates by
 * resolved markup (two identical footers share one file) and assigns a
 * deterministic, collision-free file slug per distinct pattern body.
 */
class PatternEmitter {
  private readonly phpBySlug = new Map<string, string>();
  private readonly slugByMarkup = new Map<string, string>();
  private readonly baseCount = new Map<string, number>();

  constructor(private readonly themeSlug: string) {}

  /** Register a patternRef, returning the registered slug (`<theme>/<fileSlug>`). */
  register(node: PatternRef): string {
    const meta = getPatternMeta(node.pattern);
    if (!meta) {
      // Should never happen post-validation, but fail loudly rather than emit a
      // dangling wp:pattern reference.
      throw new Error(`Cannot assemble unknown pattern '${node.pattern}'.`);
    }
    // Resolve + provision the nav that may live inside the blob (blob-aware path).
    const markup = provisionNavigationMarkup(substitutePattern(node));

    const existing = this.slugByMarkup.get(markup);
    if (existing) return `${this.themeSlug}/${existing}`;

    const fileSlug = this.allocateSlug(node.pattern);
    this.slugByMarkup.set(markup, fileSlug);
    const registeredSlug = `${this.themeSlug}/${fileSlug}`;
    this.phpBySlug.set(fileSlug, buildPatternPhp(meta.title, registeredSlug, markup));
    return registeredSlug;
  }

  /** A unique file slug for a pattern base: `base`, then `base-2`, `base-3`, … */
  private allocateSlug(base: string): string {
    const n = (this.baseCount.get(base) ?? 0) + 1;
    this.baseCount.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  }

  /** The emitted `patterns/*.php` files, as assembled-file entries. */
  files(): AssembledFile[] {
    return [...this.phpBySlug.entries()].map(([slug, content]) => ({
      path: `patterns/${slug}.php`,
      content,
    }));
  }
}

/** A minimal valid posts-index used only when an IR declares no template region. */
function fallbackIndexMarkup(): string {
  return (
    serializeNodes([
      {
        block: "core/group",
        nodeKind: "static",
        attributes: { tagName: "main", layout: { type: "constrained" } },
        innerBlocks: [
          {
            block: "core/query",
            nodeKind: "static",
            attributes: { query: { perPage: 10, postType: "post" } },
            innerBlocks: [
              {
                block: "core/post-template",
                nodeKind: "static",
                innerBlocks: [
                  { block: "core/post-title", nodeKind: "static" },
                  { block: "core/post-excerpt", nodeKind: "static" },
                ],
              },
            ],
          },
        ],
      },
    ]) + "\n"
  );
}

/**
 * Assemble a validated IR into a theme file tree (theme-relative paths). Runs the
 * blob-integrity gate first and the layer-4 scan last; throws AssemblyError if the
 * assembled artifact fails layer 4.
 */
export function assembleThemeFiles(ir: IR): AssembledFile[] {
  // 0. Pattern-blob integrity gate (U8 security review): stop before any bytes
  //    from a drifted/compromised seed blob can enter the artifact.
  assertPatternManifest();

  const themeSlug = ir.theme.slug;
  assertSafeSlug(themeSlug, "theme.slug");

  const files: AssembledFile[] = [];

  // 1. Theme identity + design tokens.
  files.push({ path: "style.css", content: buildStyleCss(ir.theme) });
  files.push({ path: "theme.json", content: stringifyThemeJson(compileThemeJson(ir.tokens)) });

  // 2 + 3. Regions → template/part markup, with patternRef expansion and nav
  //        provisioning.
  const emitter = new PatternEmitter(themeSlug);
  const templateMarkup = new Map<string, string>();
  let firstTemplateMarkup: string | undefined;

  for (const region of ir.regions) {
    const chunks = region.content.map((node) => {
      if (isPatternRef(node)) {
        const registeredSlug = emitter.register(node);
        return `<!-- wp:pattern {"slug":"${registeredSlug}"} /-->`;
      }
      return serializeBlockNode(node);
    });
    // serialize() joins top-level blocks with a blank line; mirror that, then
    // provision any free-tree navigation in the composed region markup.
    let markup = chunks.join("\n\n");
    markup = provisionNavigationMarkup(markup);
    if (!markup.endsWith("\n")) markup += "\n";

    if (region.kind === "template") {
      const path = `templates/${region.name}.html`;
      files.push({ path, content: markup });
      templateMarkup.set(region.name, markup);
      firstTemplateMarkup ??= markup;
    } else {
      files.push({ path: `parts/${region.name}.html`, content: markup });
    }
  }

  // 4. Guarantee templates/index.html — the file that makes wp_is_block_theme()
  //    true. Prefer an authored index; else fall back to home, then the first
  //    template region, then a minimal posts index.
  if (!templateMarkup.has("index")) {
    const source = templateMarkup.get("home") ?? firstTemplateMarkup ?? fallbackIndexMarkup();
    files.push({ path: "templates/index.html", content: source });
  }

  // Pattern files last (order is irrelevant — packZip sorts).
  files.push(...emitter.files());

  // 5. Layer-4 scan: fail closed on any finding.
  const errors = scanAssembledArtifact(files);
  if (errors.length > 0) throw new AssemblyError(errors);

  return files;
}

/** Assemble a validated IR straight to byte-reproducible .zip bytes. */
export async function assembleThemeZip(ir: IR): Promise<Uint8Array> {
  const files = assembleThemeFiles(ir);
  return packZip(files, ir.theme.slug);
}

/**
 * Assemble + write the theme .zip to `outDir` (default the git-ignored
 * `generated/`). Returns the written path.
 */
export async function writeThemeZip(ir: IR, outDir = "generated"): Promise<string> {
  const bytes = await assembleThemeZip(ir);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${ir.theme.slug}.zip`);
  writeFileSync(out, bytes);
  return out;
}
