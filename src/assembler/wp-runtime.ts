// Shared `@wordpress/blocks` runtime for the assembler — the single acquisition
// point for `createBlock` / `serialize` / `parse`, so every caller shares ONE
// module instance with the core block types registered.
//
// Two execution-time facts (discovered when U8 landed) shape this module
// (origin Open Questions — "serialize() headless in Node"):
//
//   1. `@wordpress/blocks`' `serialize()` recurses forever (`Maximum call stack
//      size exceeded` in `@wordpress/data`) unless the core block *types* are
//      registered first, and `@wordpress/block-library`'s registration touches
//      `window` at import time. So a DOM + core-block registration are hard
//      prerequisites — `./dom-bootstrap` (imported first, for its side effect)
//      installs the DOM before `@wordpress/block-library` evaluates.
//
//   2. Registration is process-global. If different callers `require` vs `import`
//      the package they get *different* instances, and registration on one is
//      invisible to the other (the bug that first surfaced as an unregistered-
//      block stack overflow under Vite). Hence every assembler module imports the
//      block API from THIS module, never directly — one instance, one registry.
import "./dom-bootstrap"; // side effect: install a DOM before block-library loads

import { createBlock, getBlockTypes, parse, serialize, type Block } from "@wordpress/blocks";
import { registerCoreBlocks } from "@wordpress/block-library";

/**
 * A parsed/created WordPress block instance (`@wordpress/blocks`' `Block`). Re-
 * exported under a stable local alias so assembler modules don't each import the
 * upstream type name (which has churned across versions).
 */
export type BlockInstance = Block;

let registered = false;

/**
 * Register the core block types exactly once. Idempotent and cheap after the
 * first call. Invoked by the API accessors below, so callers never have to
 * remember to call it.
 */
export function ensureWpRuntime(): void {
  if (registered) return;
  if (getBlockTypes().length === 0) {
    registerCoreBlocks();
  }
  registered = true;
}

/** `createBlock`, guaranteed to run against the registered runtime. */
export function wpCreateBlock(
  name: string,
  attributes?: Record<string, unknown>,
  innerBlocks?: BlockInstance[],
): BlockInstance {
  ensureWpRuntime();
  return createBlock(name, attributes, innerBlocks);
}

/** `serialize`, guaranteed to run against the registered runtime. */
export function wpSerialize(blocks: BlockInstance | BlockInstance[]): string {
  ensureWpRuntime();
  return serialize(blocks);
}

/** `parse`, guaranteed to run against the registered runtime. */
export function wpParse(content: string): BlockInstance[] {
  ensureWpRuntime();
  return parse(content);
}
