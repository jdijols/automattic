// @vitest-environment jsdom
//
// Site-data provisioning tests (origin §6.5). core/navigation references a
// wp_navigation menu *entity* that does not exist in a freshly-installed theme,
// so without provisioning the block renders empty and fails U10 assertion 4.
// Provisioning rewrites every navigation to page-list fallback mode — no stored
// `ref`, an explicit core/page-list child — so it renders non-empty against the
// site's pages alone, with no database menu.
//
// The defining requirement (doc-review: adversarial — P1 gap): provisioning must
// be BLOB-AWARE, not only IR-node-aware. The site-footer pattern carries its
// navigation INSIDE the pre-serialized blob, where the assembler never sees it as
// an IR node — so provisioning operates on assembled MARKUP and catches both the
// free-tree path and the in-blob path with one mechanism.
import { describe, expect, it } from "vitest";

import { provisionNavigationMarkup } from "./provisioning";
import { substitutePattern } from "./patterns";
import { wpParse, wpSerialize } from "./wp-runtime";

/** Count core/navigation blocks (recursively) whose subtree contains a page-list. */
function navsWithPageList(markup: string): number {
  let count = 0;
  const walk = (blocks: ReturnType<typeof wpParse>): void => {
    for (const b of blocks) {
      if (b.name === "core/navigation") {
        const hasPL = JSON.stringify(b.innerBlocks).includes("core/page-list");
        if (hasPL) count += 1;
      }
      if (b.innerBlocks?.length) walk(b.innerBlocks);
    }
  };
  walk(wpParse(markup));
  return count;
}

describe("provisionNavigationMarkup (free-tree IR-node path)", () => {
  it("injects a page-list child into an empty navigation so it renders non-empty", () => {
    const before = `<!-- wp:navigation {"overlayMenu":"mobile"} /-->`;
    const after = provisionNavigationMarkup(before);
    expect(after).toContain("wp:page-list");
    expect(navsWithPageList(after)).toBe(1);
  });

  it("strips a stored-menu ref (which points at a non-existent entity)", () => {
    const before = `<!-- wp:navigation {"ref":42} /-->`;
    const after = provisionNavigationMarkup(before);
    expect(after).not.toContain('"ref"');
  });
});

describe("provisionNavigationMarkup (blob-aware path — the P1 case)", () => {
  it("provisions navigation that lives inside a resolved pattern blob (site-footer)", () => {
    // The footer's nav is inside the pre-serialized blob, not an IR node.
    const resolved = substitutePattern({ pattern: "site-footer", nodeKind: "static" });
    expect(resolved).toContain("wp:navigation");
    expect(navsWithPageList(resolved)).toBe(0); // not yet provisioned

    const provisioned = provisionNavigationMarkup(resolved);
    expect(navsWithPageList(provisioned)).toBe(1); // now renders non-empty
  });
});

describe("provisionNavigationMarkup (no-op safety)", () => {
  it("returns nav-free markup byte-for-byte unchanged (no needless round-trip)", () => {
    const markup = wpSerialize(wpParse(`<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->`));
    expect(provisionNavigationMarkup(markup)).toBe(markup);
  });

  it("is idempotent — provisioning twice equals provisioning once", () => {
    const once = provisionNavigationMarkup(`<!-- wp:navigation {"ref":7} /-->`);
    expect(provisionNavigationMarkup(once)).toBe(once);
  });
});
