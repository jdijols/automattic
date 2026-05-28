import { describe, expect, it } from "vitest";

import { type GrammarNode, validateContainment } from "./grammar";

const node = (block: string, innerBlocks: GrammarNode[] = []): GrammarNode => ({
  block,
  innerBlocks,
});

describe("containment grammar", () => {
  it("accepts a column nested in columns", () => {
    const tree = node("core/columns", [node("core/column", [node("core/paragraph")])]);
    expect(validateContainment(tree)).toEqual([]);
  });

  it("rejects a column at region root with a precise path", () => {
    const violations = validateContainment(node("core/column"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("PARENT");
    expect(violations[0]?.block).toBe("core/column");
    expect(violations[0]?.path).toBe("core/column");
  });

  it("rejects a column whose direct parent is not columns", () => {
    const tree = node("core/group", [node("core/column")]);
    const violations = validateContainment(tree);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("PARENT");
    expect(violations[0]?.path).toBe("core/group › core/column");
  });

  it("rejects a non-column child of columns (child restriction)", () => {
    const tree = node("core/columns", [node("core/paragraph")]);
    const violations = validateContainment(tree);
    expect(violations.some((v) => v.kind === "CHILD")).toBe(true);
  });

  it("accepts post-context leaves inside a query → post-template subtree", () => {
    const tree = node("core/query", [
      node("core/post-template", [
        node("core/post-featured-image"),
        node("core/post-title"),
        node("core/post-date"),
        node("core/post-excerpt"),
      ]),
    ]);
    expect(validateContainment(tree)).toEqual([]);
  });

  it("rejects a post-context leaf outside any post-template ancestor", () => {
    const violations = validateContainment(node("core/post-title"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("ANCESTOR");
    expect(violations[0]?.block).toBe("core/post-title");
  });

  it("rejects post-template with no query ancestor", () => {
    const tree = node("core/group", [node("core/post-template")]);
    const violations = validateContainment(tree);
    expect(violations.some((v) => v.kind === "ANCESTOR" && v.block === "core/post-template")).toBe(
      true,
    );
  });

  it("permits post fields wrapped in a container inside the query loop (ancestor, not parent)", () => {
    // WP constrains post-template / post-* by ANCESTOR, so nesting through a
    // group is legal — over-strict parent rules would reject valid themes.
    const tree = node("core/query", [
      node("core/post-template", [
        node("core/group", [node("core/post-title"), node("core/post-excerpt")]),
      ]),
    ]);
    expect(validateContainment(tree)).toEqual([]);
  });

  it("enforces list, social-links, and buttons allowedBlocks (block.json child restrictions)", () => {
    // core/list ∋ only list-item; list-item ∋ only a nested list.
    expect(validateContainment(node("core/list", [node("core/list-item")]))).toEqual([]);
    expect(
      validateContainment(node("core/list", [node("core/paragraph")])).some((v) => v.kind === "CHILD"),
    ).toBe(true);
    expect(
      validateContainment(node("core/list", [node("core/list-item", [node("core/paragraph")])])).some(
        (v) => v.kind === "CHILD" && v.block === "core/paragraph",
      ),
    ).toBe(true);

    // core/social-links ∋ only social-link; an orphan social-link is rejected.
    expect(
      validateContainment(node("core/social-links", [node("core/social-link")])),
    ).toEqual([]);
    expect(
      validateContainment(node("core/social-links", [node("core/paragraph")])).some(
        (v) => v.kind === "CHILD",
      ),
    ).toBe(true);
    expect(validateContainment(node("core/social-link"))[0]?.kind).toBe("PARENT");

    // core/buttons ∋ only button.
    expect(validateContainment(node("core/buttons", [node("core/paragraph")])).some((v) => v.kind === "CHILD")).toBe(
      true,
    );

    // core/query-pagination ∋ only the three pagination sub-blocks.
    const badPagination = node("core/query", [
      node("core/query-pagination", [node("core/paragraph")]),
    ]);
    expect(badPagination && validateContainment(badPagination).some((v) => v.kind === "CHILD")).toBe(
      true,
    );
  });

  it("constrains buttons, list-item, and pagination sub-blocks to their parents", () => {
    expect(validateContainment(node("core/button"))[0]?.kind).toBe("PARENT");
    expect(validateContainment(node("core/buttons", [node("core/button")]))).toEqual([]);

    expect(validateContainment(node("core/list-item"))[0]?.kind).toBe("PARENT");
    expect(validateContainment(node("core/list", [node("core/list-item")]))).toEqual([]);

    expect(validateContainment(node("core/query-pagination-next"))[0]?.kind).toBe("PARENT");
    const pagination = node("core/query", [
      node("core/query-pagination", [
        node("core/query-pagination-previous"),
        node("core/query-pagination-numbers"),
        node("core/query-pagination-next"),
      ]),
    ]);
    expect(validateContainment(pagination)).toEqual([]);
  });

  it("accepts the full seed-shaped query-loop tree with no violations", () => {
    const tree = node("core/group", [
      node("core/heading"),
      node("core/query", [
        node("core/post-template", [
          node("core/post-featured-image"),
          node("core/post-title"),
          node("core/post-date"),
          node("core/post-excerpt"),
        ]),
        node("core/query-pagination", [
          node("core/query-pagination-previous"),
          node("core/query-pagination-numbers"),
          node("core/query-pagination-next"),
        ]),
      ]),
    ]);
    expect(validateContainment(tree)).toEqual([]);
  });

  it("reports the offending path for a deeply nested violation", () => {
    const tree = node("core/group", [node("core/columns", [node("core/column", [node("core/column")])])]);
    const violations = validateContainment(tree);
    // inner column's parent is a column, not columns
    expect(violations.some((v) => v.path === "core/group › core/columns › core/column › core/column")).toBe(
      true,
    );
  });
});
