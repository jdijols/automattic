// Build-time extraction of the attribute key/type surface from core `block.json`
// (origin §4.2, Q8). `@wordpress/blocks` ships zero `block.json` files; the core
// block definitions live in `@wordpress/block-library`, which is pinned to an
// exact version (package.json) so this surface is deterministic and version-
// coherent with the U5 vendored theme.json schema.
//
// `block.json` gives the authoritative *key/type* surface for free. The
// correctness-critical *value ranges* (heading.level ∈ 1..6, cover.dimRatio ∈
// 0..100) are NOT in block.json and live in the hand-authored overlay in
// attributes.ts. Reads are cached per block.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type AllowedBlockName } from "./allowlist";

const require = createRequire(import.meta.url);

export interface BlockJsonAttribute {
  type?: string;
  enum?: unknown[];
  default?: unknown;
}

export interface CoreBlockJson {
  name: string;
  attributes: Record<string, BlockJsonAttribute>;
  supports?: Record<string, unknown>;
}

let cachedRoot: string | undefined;

function blockLibraryRoot(): string {
  if (cachedRoot) return cachedRoot;
  try {
    cachedRoot = dirname(require.resolve("@wordpress/block-library/package.json"));
  } catch {
    // Fall back to the resolved main entry's package directory if the package
    // does not expose package.json in its exports map.
    cachedRoot = dirname(dirname(require.resolve("@wordpress/block-library")));
  }
  return cachedRoot;
}

const jsonCache = new Map<AllowedBlockName, CoreBlockJson>();

/** The directory name under block-library/src is the block name without the `core/` prefix. */
function shortName(block: AllowedBlockName): string {
  return block.replace(/^core\//, "");
}

/**
 * Load and cache a core block's `block.json`. Throws loudly if the file is
 * missing — a silent miss would let the attribute overlay accept anything,
 * defeating the unknown-key guard.
 */
export function loadCoreBlockJson(block: AllowedBlockName): CoreBlockJson {
  const cached = jsonCache.get(block);
  if (cached) return cached;

  const path = join(blockLibraryRoot(), "src", shortName(block), "block.json");
  let parsed: CoreBlockJson;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as CoreBlockJson;
  } catch (cause) {
    throw new Error(`Unable to read block.json for ${block} at ${path}`, { cause });
  }
  if (!parsed.attributes || typeof parsed.attributes !== "object") {
    parsed.attributes = {};
  }
  jsonCache.set(block, parsed);
  return parsed;
}

const keyCache = new Map<AllowedBlockName, Set<string>>();

/** The set of block-specific attribute keys declared in a block's `block.json`. */
export function getCoreAttributeKeys(block: AllowedBlockName): Set<string> {
  const cached = keyCache.get(block);
  if (cached) return cached;
  const keys = new Set(Object.keys(loadCoreBlockJson(block).attributes));
  keyCache.set(block, keys);
  return keys;
}
