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
  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.self = dom.window;
  for (const key of DOM_GLOBAL_KEYS) {
    const value = (dom.window as unknown as Record<string, unknown>)[key];
    if (value !== undefined && g[key] === undefined) g[key] = value;
  }
  if (typeof g.requestAnimationFrame !== "function") {
    g.requestAnimationFrame = (cb: (t: number) => void): number =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
  }
  if (typeof g.cancelAnimationFrame !== "function") {
    g.cancelAnimationFrame = (): void => {};
  }
}

installDom();
