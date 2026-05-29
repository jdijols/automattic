// Deterministic .zip packaging (origin §6.3, R3). The hard requirement is
// byte-reproducibility ACROSS MACHINES: the same IR must yield the same archive
// bytes on a contributor's laptop and on the CI runner. A naive JSZip call fails
// this in five subtle ways, each pinned here:
//
//   1. Compression — zlib's DEFLATE output varies by version/platform, so the
//      default would pass same-machine and fail on CI. We use STORE (no zlib),
//      trading a larger archive for exact reproducibility.
//   2. Timestamps — every entry carries a mod time. We set one fixed UTC date on
//      every entry. (JSZip 3.10 serializes the DOS date via getUTC*, so this is
//      timezone-independent; verified against the installed version.)
//   3. Permission / platform bits — host-derived archive metadata would leak into
//      the central directory. We pin platform=UNIX + a fixed unix mode on every
//      entry, and disable implicit folder entries (which JSZip would otherwise
//      stamp with `new Date()` at generation time — a non-deterministic leak).
//   4. Unicode form — an NFC and an NFD spelling of the same text serialize to
//      different bytes. We NFC-normalize all content and paths at this boundary.
//   5. Line endings — CRLF vs LF changes bytes. We normalize all text to LF.
//
// The committed golden-zip test (index.test.ts) is what proves this holds across
// environments: a contributor or CI image with a different zlib/locale/line
// ending surfaces as a golden diff rather than a silent regression.
import JSZip from "jszip";

import { assertSafeRelPath, assertSafeSlug } from "./escaping";
import type { AssembledFile } from "../validator/layer4-scan";

// A fixed point in time (post-1980 DOS epoch) stamped on every entry. The exact
// value is arbitrary; only its constancy matters for reproducibility.
const FIXED_DATE = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
// Fixed unix file mode (rw-r--r--) so host umask does not leak into the archive.
const FILE_MODE = 0o644;

/** Normalize a text payload to the canonical byte form: NFC + LF line endings. */
function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

/**
 * Pack a theme file tree into a byte-reproducible .zip, nested under a single
 * top-level `<rootDir>/` directory (the WordPress theme-install convention).
 * `rootDir` is charset-validated and every entry path is re-checked for traversal
 * before it is written, so a hostile slug or path cannot escape the archive root.
 */
export async function packZip(
  files: readonly AssembledFile[],
  rootDir: string,
): Promise<Uint8Array> {
  assertSafeSlug(rootDir, "theme root directory");

  const zip = new JSZip();

  // Sort by path so entry order (and thus the central directory) is deterministic
  // regardless of the order the assembler produced the files in.
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const file of sorted) {
    assertSafeRelPath(file.path);
    const entryPath = `${rootDir}/${file.path}`.normalize("NFC");
    // Defense in depth: re-validate the composed path too.
    assertSafeRelPath(entryPath);
    zip.file(entryPath, normalizeText(file.content), {
      date: FIXED_DATE,
      unixPermissions: FILE_MODE,
      // No implicit folder entries — they would carry a generation-time date.
      createFolders: false,
    });
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
    platform: "UNIX",
  });
}
