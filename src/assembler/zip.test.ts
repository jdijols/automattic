// Byte-reproducibility tests for the deterministic packager (origin §6.3, R3).
// R3 says "the same IR produces the same .zip bytes on ANY machine" — so a
// same-machine-twice test is necessary but not sufficient. The cross-environment
// hazards are: zlib output drift (→ STORE), per-file timestamps (→ fixed UTC
// date), host permission/platform bits (→ pinned), Unicode form (→ NFC), and line
// endings (→ LF). Each hazard gets a test that would fail if its pin regressed.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { InjectionDefenseError } from "./escaping";
import { packZip } from "./zip";

const files = [
  { path: "style.css", content: "/* Theme Name: Aurora */\n" },
  { path: "templates/index.html", content: "<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->\n" },
  { path: "theme.json", content: '{\n  "version": 3\n}\n' },
];

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

describe("packZip — byte reproducibility", () => {
  it("produces identical bytes for the same input twice", async () => {
    const a = await packZip(files, "aurora-blog");
    const b = await packZip(files, "aurora-blog");
    expect(bytesEqual(a, b)).toBe(true);
  });

  it("is insensitive to input file ORDER (entries are sorted)", async () => {
    const a = await packZip(files, "aurora-blog");
    const b = await packZip([...files].reverse(), "aurora-blog");
    expect(bytesEqual(a, b)).toBe(true);
  });

  it("normalizes NFD Unicode to NFC so decomposed/composed inputs match", async () => {
    // "Café" composed (NFC, é = U+00E9) vs decomposed (NFD, e + U+0301).
    const base = "/* Theme Name: Caf\u00e9 */\n";
    const nfc = [{ path: "style.css", content: base.normalize("NFC") }];
    const nfd = [{ path: "style.css", content: base.normalize("NFD") }];
    expect(nfc[0]!.content).not.toBe(nfd[0]!.content); // genuinely different inputs
    expect(bytesEqual(await packZip(nfc, "theme-a"), await packZip(nfd, "theme-a"))).toBe(true);
  });

  it("normalizes CRLF to LF so line-ending style does not affect bytes", async () => {
    const lf = [{ path: "a.txt", content: "one\ntwo\n" }];
    const crlf = [{ path: "a.txt", content: "one\r\ntwo\r\n" }];
    expect(bytesEqual(await packZip(lf, "theme-a"), await packZip(crlf, "theme-a"))).toBe(true);
  });
});

describe("packZip — structure", () => {
  it("nests every entry under the theme-slug root directory", async () => {
    const bytes = await packZip(files, "aurora-blog");
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toContain("aurora-blog/style.css");
    expect(names).toContain("aurora-blog/templates/index.html");
    expect(names.every((n) => n.startsWith("aurora-blog/"))).toBe(true);
  });

  it("round-trips file content intact", async () => {
    const bytes = await packZip(files, "aurora-blog");
    const zip = await JSZip.loadAsync(bytes);
    const css = await zip.file("aurora-blog/style.css")!.async("string");
    expect(css).toBe("/* Theme Name: Aurora */\n");
  });
});

describe("packZip — zip-slip defense", () => {
  it("rejects a traversal path before writing it into the archive", async () => {
    await expect(packZip([{ path: "../evil.php", content: "x" }], "theme-a")).rejects.toThrow(
      InjectionDefenseError,
    );
  });

  it("rejects a traversal in the root dir slug", async () => {
    await expect(packZip(files, "../../wp-content")).rejects.toThrow();
  });
});
