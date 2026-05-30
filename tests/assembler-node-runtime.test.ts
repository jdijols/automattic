// Real-Node-runtime regression guard for the assembler's DOM bootstrap (#49).
//
// EVERY other assembler/e2e test runs under `// @vitest-environment jsdom`,
// where window/document/navigator already exist and src/assembler/dom-bootstrap
// is a NO-OP. That left the actual production path — assembling under plain Node,
// where dom-bootstrap synthesizes the DOM — completely unexercised. On Node >= 21
// `globalThis.navigator` is a configurable getter-only accessor, so the old
// `globalThis.navigator = ...` assignment threw under ESM strict mode at import
// time, crashing `next build` and every assembled-zip request (#49).
//
// This file deliberately has NO jsdom pragma, so it runs under the fast gate's
// default `node` environment: importing the assembler triggers the real
// dom-bootstrap, and assembling a fixture proves the whole headless path works in
// Node. Before the defineProperty fix this test fails at import on Node >= 21.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { irSchema } from "../src/ir/schema";

const repo = (...s: string[]): string => resolve(process.cwd(), ...s);

describe("assembler runs headless under the real Node runtime (#49 regression)", () => {
  it("imports the assembler and produces a theme .zip without a jsdom test env", async () => {
    // Dynamic import so the dom-bootstrap side effect runs inside the test (and a
    // throw surfaces as a failing assertion, not an unhandled module-load error).
    const { assembleThemeZip } = await import("../src/assembler/index");

    const fixture = JSON.parse(
      readFileSync(repo("fixtures/positive/blog/blog.json"), "utf8"),
    ) as { input: unknown };
    const ir = irSchema.parse(fixture.input);

    const zip = await assembleThemeZip(ir);

    // Real zip bytes: local-file-header magic "PK\x03\x04".
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
  });

  it("synthesized a DOM on the real global (navigator defined, not thrown)", () => {
    // After the import above, the bootstrap has run. Under Node these globals are
    // the jsdom-synthesized ones; the assertion that matters is simply that
    // defining navigator did not throw and left a usable value.
    expect(typeof (globalThis as { navigator?: unknown }).navigator).toBe("object");
  });
});
