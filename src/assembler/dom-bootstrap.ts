// Side-effecting DOM bootstrap — MUST be imported before `@wordpress/block-library`.
//
// `@wordpress/block-library` references `window` at module-evaluation time (its
// `registerCoreBlocks` wiring), so a DOM has to exist *before* that package is
// imported. ES module imports evaluate depth-first in source order, so any module
// that needs the WordPress block runtime imports THIS module first, then the
// `@wordpress/*` packages — guaranteeing the DOM is in place when their factories
// run. (origin Open Questions: "serialize() headless in Node" → DOM shim.)
//
// Under Vitest's `jsdom` environment (and any browser-like host) the DOM globals
// already exist, so this module is a no-op there. In plain Node it synthesizes a
// minimal DOM with jsdom. Importing for side effects only.

const DOM_GLOBAL_KEYS = [
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Document",
  "DocumentFragment",
  "getComputedStyle",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "DOMParser",
] as const;

// Assign a global via `Object.defineProperty`, NOT a plain `g.key = value`.
// On Node >= 21 some of these globals (notably `navigator`, since Node 21
// shipped a built-in `Navigator`) are exposed as CONFIGURABLE GETTER-ONLY
// accessor properties. A plain assignment to a getter-only property silently
// no-ops in sloppy mode but THROWS ("Cannot set property navigator ... which
// has only a getter") in strict mode — and this module is an ES module, so it
// always runs strict. `defineProperty` redefines the slot (the property is
// configurable, so this is allowed) and works uniformly whether the slot was a
// read-only accessor or absent. (Fixes #49: the assembled-zip path crashed at
// request/build time on production Node.)
function defineGlobal(g: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(g, key, { value, configurable: true, writable: true });
}

function installDom(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.window !== "undefined" && typeof g.document !== "undefined") {
    return; // DOM already present (Vitest jsdom env / browser-like host)
  }
  // Lazy require so the jsdom cost is only paid when a real DOM is missing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = require("jsdom") as typeof import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  defineGlobal(g, "window", dom.window);
  defineGlobal(g, "document", dom.window.document);
  defineGlobal(g, "navigator", dom.window.navigator);
  defineGlobal(g, "self", dom.window);
  for (const key of DOM_GLOBAL_KEYS) {
    const value = (dom.window as unknown as Record<string, unknown>)[key];
    if (value !== undefined && g[key] === undefined) defineGlobal(g, key, value);
  }
  if (typeof g.requestAnimationFrame !== "function") {
    defineGlobal(g, "requestAnimationFrame", (cb: (t: number) => void): number =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number);
  }
  if (typeof g.cancelAnimationFrame !== "function") {
    defineGlobal(g, "cancelAnimationFrame", (): void => {});
  }
}

installDom();
