// Unit tests for the gate's PHP builders + result parser. These are pure string
// operations — no Playground boot — so they live in the fast gate and pin the
// marker protocol, slug-escaping guard, and parse robustness that the slow
// integration test then relies on.
import { describe, expect, it } from "vitest";

import { InjectionDefenseError } from "../assembler/escaping";
import {
  buildAssertionScript,
  buildInstallScript,
  GATE_BEGIN,
  GATE_END,
  parseGateOutput,
  ZIP_VFS_PATH,
} from "./blueprint";

describe("buildInstallScript", () => {
  it("unzips the vfs zip and switches to the theme slug", () => {
    const php = buildInstallScript("aurora-blog");
    expect(php).toContain(`unzip_file('${ZIP_VFS_PATH}'`);
    expect(php).toContain("switch_theme('aurora-blog')");
    expect(php).toContain("INSTALL_OK");
  });

  it("refuses an unsafe slug (no PHP injection via the slug)", () => {
    expect(() => buildInstallScript("a'); system('rm -rf /'); //")).toThrow(InjectionDefenseError);
  });
});

describe("buildAssertionScript", () => {
  it("includes all four assertions", () => {
    const php = buildAssertionScript("aurora-blog");
    expect(php).toContain("wp_get_theme()"); // activation
    expect(php).toContain("parse_blocks("); // block resolution
    expect(php).toContain("core/html"); // disqualifying-block check
    expect(php).toContain("WP_Theme_JSON("); // dropped-key
    expect(php).toContain("wp-block-navigation"); // nav render
    expect(php).toContain(GATE_BEGIN);
    expect(php).toContain(GATE_END);
  });

  it("refuses an unsafe slug", () => {
    expect(() => buildAssertionScript("../evil")).toThrow(InjectionDefenseError);
  });
});

describe("parseGateOutput", () => {
  it("extracts the failures array from between the markers (ignoring surrounding noise)", () => {
    const stdout = `PHP Notice: something\n${GATE_BEGIN}{"failures":[{"check":"navigation","message":"empty","detail":"parts/footer.html"}]}${GATE_END}\ntrailing`;
    const failures = parseGateOutput(stdout);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.check).toBe("navigation");
  });

  it("returns [] for a clean run (empty failures)", () => {
    expect(parseGateOutput(`${GATE_BEGIN}{"failures":[]}${GATE_END}`)).toEqual([]);
  });

  it("throws when the markers are missing (a crash, not a pass)", () => {
    expect(() => parseGateOutput("Fatal error: boom")).toThrow(/no parseable result/i);
  });
});
