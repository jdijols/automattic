// Layer 4 — the assembled-artifact scan (origin §5.1). Layers 1–3 validate the
// IR and the compiled theme.json; layer 4 validates the BYTES that ship. It is
// the final, in-depth guard for the disqualifying no-Custom-HTML constraint and
// the hallucinated-name invariant, and it runs against the assembled file tree
// (post-U9-assembly), not the IR — so it catches a raw delimiter regardless of
// how it arrived (a mutated pattern blob, a serializer regression, a hand edit).
//
// Two checks per scanned file, mapping to the two FIXED layer-4 invariants whose
// codes were declared in the frozen U4 enum (this layer adds none):
//   1. Byte scan — the normalized bytes must not contain a raw wp:html /
//      wp:core/html block delimiter (RAW_HTML_DETECTED / "wp-html"). Normalized
//      the same way the U8 substitution guard normalizes, so casing/whitespace
//      evasions (`<!--  WP:HTML  -->`) fall the same way.
//   2. Re-parse — every block name in the markup must resolve to the U2 allowlist
//      (UNRESOLVED_BLOCK_NAME / "hallucinated-block-name"). This also catches
//      undelimited HTML, which `@wordpress/blocks` parses to `core/missing`.
//
// Scanned file kinds: templates/*.html, parts/*.html, patterns/*.php. Other files
// (style.css, theme.json) are not block markup and are skipped.
import { isAllowedBlock } from "../blocks/allowlist";
import { makeError, type ValidationError } from "./errors";
import { wpParse, type BlockInstance } from "../assembler/wp-runtime";

/** One assembled file: its theme-relative path and its full text content. */
export interface AssembledFile {
  path: string;
  content: string;
}

/** Whitespace + control/format characters stripped before sequence matching. */
const STRIP = /[\s\p{Cc}\p{Cf}]/gu;

/** Normalize for delimiter detection: drop whitespace/controls, case-fold. */
function normalize(value: string): string {
  return value.replace(STRIP, "").toLowerCase();
}

// The Custom HTML block delimiter in both its short and fully-qualified forms,
// matched against the NORMALIZED bytes so evasions collapse to the same needle.
const RAW_HTML_NEEDLES = ["<!--wp:html", "<!--wp:core/html"] as const;

// Real core blocks the ASSEMBLER itself introduces during assembly — they are not
// in the IR authoring allowlist (the IR cannot express them) but are legitimate,
// registered WordPress blocks in the assembled artifact, so name resolution must
// accept them: `core/page-list` (injected by nav provisioning as the page-list
// fallback) and `core/pattern` (the reference a patternRef expands into, pointing
// at a registered theme pattern in patterns/*.php). Kept as an explicit, audited
// set rather than widening to the whole core registry, so a genuinely hallucinated
// or non-authored block still fails.
const ASSEMBLER_INTRODUCED = new Set<string>(["core/page-list", "core/pattern"]);

/** Does a path designate a file kind whose bytes we scan as block markup? */
function isScannedFile(path: string): boolean {
  return (
    (path.startsWith("templates/") && path.endsWith(".html")) ||
    (path.startsWith("parts/") && path.endsWith(".html")) ||
    (path.startsWith("patterns/") && path.endsWith(".php"))
  );
}

/**
 * The block-markup body of a scanned file. A pattern `.php` file is a PHP header
 * comment + `?>` + the block markup; only the markup after the first `?>` can be
 * parsed by `@wordpress/blocks`. `.html` files are markup in their entirety.
 */
function markupBody(file: AssembledFile): string {
  if (file.path.endsWith(".php")) {
    const idx = file.content.indexOf("?>");
    return idx === -1 ? file.content : file.content.slice(idx + 2);
  }
  return file.content;
}

/** Recursively collect every non-empty block name in a parsed tree. */
function collectNames(blocks: BlockInstance[], out: string[]): void {
  for (const block of blocks) {
    if (block.name) out.push(block.name);
    if (block.innerBlocks?.length) collectNames(block.innerBlocks, out);
  }
}

/**
 * Scan an assembled file tree for the layer-4 invariants. Returns a structured
 * error list (empty = clean). Pure and fail-closed: the assembler treats a
 * non-empty result as a release-blocking failure.
 */
export function scanAssembledArtifact(files: readonly AssembledFile[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const file of files) {
    if (!isScannedFile(file.path)) continue;

    // 1. Byte scan for a raw Custom HTML block delimiter.
    const norm = normalize(file.content);
    for (const needle of RAW_HTML_NEEDLES) {
      if (norm.includes(needle)) {
        errors.push(
          makeError({
            code: "RAW_HTML_DETECTED",
            layer: "assembled-artifact",
            path: file.path,
            message: `Assembled file '${file.path}' contains a raw Custom HTML block delimiter — the disqualifying constraint. No wp:html may appear in any output.`,
            invariant: "wp-html",
          }),
        );
        break; // one report per file is enough; the file is already rejected
      }
    }

    // 2. Re-parse and confirm every block name resolves to the allowlist. This
    //    also catches undelimited HTML (parsed as core/missing).
    const names: string[] = [];
    collectNames(wpParse(markupBody(file)), names);
    const seen = new Set<string>();
    for (const name of names) {
      if (isAllowedBlock(name) || ASSEMBLER_INTRODUCED.has(name) || seen.has(name)) continue;
      seen.add(name);
      errors.push(
        makeError({
          code: "UNRESOLVED_BLOCK_NAME",
          layer: "assembled-artifact",
          path: `${file.path} › ${name}`,
          message: `Assembled file '${file.path}' contains a block '${name}' that does not resolve to the allowlist (a hallucinated name or undelimited HTML parsed as core/missing).`,
          invariant: "hallucinated-block-name",
        }),
      );
    }
  }

  return errors;
}
