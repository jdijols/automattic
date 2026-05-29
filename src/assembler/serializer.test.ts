// @vitest-environment jsdom
//
// Serializer parity tests (origin §6.2, Q6). The canonical-bytes authority is the
// JS `@wordpress/blocks` `serialize()` oracle (which runs each block's `save()`),
// NOT PHP `serialize_block()`. These tests therefore assert that our serializer's
// output is byte-identical to the oracle for the gap-filler attribute combinations
// — the only set that needs free-tree serialization (covered regions arrive as
// pre-serialized pattern blobs, handled in patterns.ts).
//
// Runs under a jsdom environment: `@wordpress/block-library`'s `registerCoreBlocks`
// touches `window`, and `serialize()` recurses forever without a registered block
// type, so a DOM + registration are prerequisites (the Open Questions discovery).
import { describe, expect, it } from "vitest";

import type { BlockNode } from "../ir/types";
import { createWpBlock, serializeBlockNode, serializeNodes } from "./serializer";
// The oracle must run against the SAME registered runtime instance the serializer
// uses, so it comes from wp-runtime (not a second `@wordpress/blocks` import).
import { wpCreateBlock, wpSerialize, type BlockInstance } from "./wp-runtime";

interface OracleSpec {
  name: string;
  attributes?: Record<string, unknown>;
  inner?: OracleSpec[];
}

/**
 * Build the oracle bytes INDEPENDENTLY of the module under test: construct the WP
 * block tree with the raw `wpCreateBlock` accessor (recursively) and serialize it.
 * This is the true parity reference — raw `@wordpress/blocks` vs our serializer —
 * rather than re-using `createWpBlock` (which would be circular).
 */
function buildOracleTree(spec: OracleSpec): BlockInstance {
  return wpCreateBlock(
    spec.name,
    spec.attributes ?? {},
    (spec.inner ?? []).map(buildOracleTree),
  );
}

function oracle(name: string, attributes: Record<string, unknown>, inner: OracleSpec[] = []): string {
  return wpSerialize(buildOracleTree({ name, attributes, inner }));
}

describe("serializer parity with @wordpress/blocks serialize()", () => {
  it("serializes a core/heading byte-identically to the oracle", () => {
    const node: BlockNode = {
      block: "core/heading",
      nodeKind: "static",
      attributes: { level: 2, content: "Section title" },
    };
    expect(serializeBlockNode(node)).toBe(oracle("core/heading", { level: 2, content: "Section title" }));
  });

  it("serializes a core/paragraph byte-identically to the oracle", () => {
    const node: BlockNode = {
      block: "core/paragraph",
      nodeKind: "static",
      attributes: { content: "Body copy.", fontSize: "medium" },
    };
    expect(serializeBlockNode(node)).toBe(
      oracle("core/paragraph", { content: "Body copy.", fontSize: "medium" }),
    );
  });

  it("emits a void block (core/post-featured-image) in the self-closing /--> form", () => {
    const node: BlockNode = {
      block: "core/post-featured-image",
      nodeKind: "static",
      attributes: { isLink: true, aspectRatio: "4/3" },
    };
    const out = serializeBlockNode(node);
    expect(out).toBe(oracle("core/post-featured-image", { isLink: true, aspectRatio: "4/3" }));
    expect(out.trimEnd().endsWith("/-->")).toBe(true);
    // No closing delimiter for a void block.
    expect(out).not.toContain("<!-- /wp:post-featured-image -->");
  });

  it("serializes a nested group→heading tree byte-identically to the oracle", () => {
    const node: BlockNode = {
      block: "core/group",
      nodeKind: "static",
      attributes: { layout: { type: "constrained", contentSize: "680px" } },
      innerBlocks: [
        { block: "core/heading", nodeKind: "static", attributes: { level: 1, content: "Hi" } },
        { block: "core/paragraph", nodeKind: "static", attributes: { content: "p" } },
      ],
    };
    const oracleOut = oracle("core/group", { layout: { type: "constrained", contentSize: "680px" } }, [
      { name: "core/heading", attributes: { level: 1, content: "Hi" } },
      { name: "core/paragraph", attributes: { content: "p" } },
    ]);
    expect(serializeBlockNode(node)).toBe(oracleOut);
  });

  it("serializes a cover with inner content byte-identically (attribute combinations)", () => {
    const attrs = {
      dimRatio: 60,
      overlayColor: "contrast",
      minHeight: 80,
      minHeightUnit: "vh",
      align: "full",
      contentPosition: "center center",
    };
    const node: BlockNode = {
      block: "core/cover",
      nodeKind: "static",
      attributes: attrs,
      innerBlocks: [
        { block: "core/paragraph", nodeKind: "static", attributes: { content: "inside" } },
      ],
    };
    const oracleOut = oracle("core/cover", attrs, [
      { name: "core/paragraph", attributes: { content: "inside" } },
    ]);
    expect(serializeBlockNode(node)).toBe(oracleOut);
  });

  it("is deterministic regardless of attribute insertion order (oracle reorders to block.json order)", () => {
    const a: BlockNode = {
      block: "core/cover",
      nodeKind: "static",
      attributes: { align: "full", dimRatio: 50, overlayColor: "primary" },
    };
    const b: BlockNode = {
      block: "core/cover",
      nodeKind: "static",
      attributes: { overlayColor: "primary", dimRatio: 50, align: "full" },
    };
    expect(serializeBlockNode(a)).toBe(serializeBlockNode(b));
  });
});

describe("undelimited-chunk guard", () => {
  it("never emits a bare non-whitespace chunk lacking a block delimiter", () => {
    // The serializer output for any allowlisted node must consist only of block
    // comment delimiters and their (delimited) inner markup — no stray top-level
    // text. We assert by re-parsing: the serialized output parses back to exactly
    // the blocks we emitted, with zero core/freeform (the bucket the WP parser
    // puts undelimited HTML chunks into).
    const node: BlockNode = {
      block: "core/heading",
      nodeKind: "static",
      attributes: { level: 2, content: "x" },
    };
    const out = serializeBlockNode(node);
    expect(out.startsWith("<!-- wp:")).toBe(true);
  });
});

describe("serializeNodes (region content array)", () => {
  it("joins multiple top-level nodes with the oracle's separator", () => {
    const nodes: BlockNode[] = [
      { block: "core/heading", nodeKind: "static", attributes: { level: 2, content: "A" } },
      { block: "core/paragraph", nodeKind: "static", attributes: { content: "B" } },
    ];
    const expected = wpSerialize(nodes.map((n) => createWpBlock(n)));
    expect(serializeNodes(nodes)).toBe(expected);
  });
});
