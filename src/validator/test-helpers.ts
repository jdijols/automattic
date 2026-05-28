// Shared test fixtures for the validator unit tests. Not part of the shipped
// API surface — imported only by *.test.ts.

/** A representative, fully-valid blog IR (passes layers 1–2 with zero errors). */
export function validBlogIR(): Record<string, unknown> {
  return {
    irVersion: 1,
    theme: { slug: "aurora-blog", title: "Aurora", wpVersionTarget: "6.6" },
    tokens: {
      colors: [
        { slug: "base", color: "#0b0b0f" },
        { slug: "contrast", color: "#f5f5f7" },
      ],
      fontSizes: [{ slug: "medium", size: "1.125rem" }],
      spacing: [{ slug: "50", size: "1.5rem" }],
    },
    regions: [
      {
        kind: "template",
        name: "index",
        content: [
          {
            block: "core/heading",
            attributes: { level: 1, textColor: "contrast" },
            text: "Aurora",
          },
          {
            block: "core/query",
            nodeKind: "template-region",
            attributes: { query: { perPage: 10, postType: "post" } },
            innerBlocks: [
              {
                block: "core/post-template",
                nodeKind: "template-region",
                innerBlocks: [{ block: "core/post-title" }, { block: "core/post-excerpt" }],
              },
            ],
          },
        ],
      },
      { kind: "part", name: "footer", content: [{ pattern: "site-footer" }] },
    ],
  };
}

/** Wrap region-root nodes in a minimal valid envelope (default tokens). */
export function wrapNodes(
  content: unknown[],
  tokens: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    irVersion: 1,
    theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
    tokens,
    regions: [{ kind: "template", name: "index", content }],
  };
}

/** Build a `core/group`-nested chain `depth` levels deep (for bound tests). */
export function nestGroups(depth: number): unknown {
  let node: Record<string, unknown> = { block: "core/paragraph" };
  for (let i = 0; i < depth - 1; i++) {
    node = { block: "core/group", innerBlocks: [node] };
  }
  return node;
}
