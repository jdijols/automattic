import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { ALLOWLIST } from "../src/blocks/allowlist";
import { irJsonSchema } from "../src/ir/json-schema";
import { ERROR_CODES } from "../src/validator/errors";

// The contract/ artifacts are GENERATED from the source of truth — the Zod schema
// (irJsonSchema) and the block allowlist (ALLOWLIST) — so the published contract
// Track 3 codes against can never silently diverge from what the validator
// actually enforces. After an intentional schema/allowlist change, regenerate with:
//   UPDATE_CONTRACT=1 npx vitest run tests/contract.test.ts
// CI runs WITHOUT that env var, so an un-regenerated change fails the drift guard.

const contractFile = (name: string): string =>
  fileURLToPath(new URL(`../contract/${name}`, import.meta.url));

const schemaJson = `${JSON.stringify(irJsonSchema, null, 2)}\n`;
const allowlistJson = `${JSON.stringify({ version: 1, blocks: ALLOWLIST }, null, 2)}\n`;

if (process.env.UPDATE_CONTRACT === "1") {
  writeFileSync(contractFile("ir-v1.schema.json"), schemaJson);
  writeFileSync(contractFile("allowlist.json"), allowlistJson);
}

describe("published contract — drift guard (regenerate-and-diff)", () => {
  it("contract/ir-v1.schema.json equals the schema emitted from the Zod source", () => {
    expect(readFileSync(contractFile("ir-v1.schema.json"), "utf8")).toBe(schemaJson);
  });

  it("contract/allowlist.json equals the ALLOWLIST source", () => {
    expect(readFileSync(contractFile("allowlist.json"), "utf8")).toBe(allowlistJson);
  });
});

describe("published contract — usable by Track 3 with no Track-1 internals", () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(
    JSON.parse(readFileSync(contractFile("ir-v1.schema.json"), "utf8")) as object,
  );

  it("a positive corpus IR validates against the PUBLISHED schema", () => {
    const blog = JSON.parse(
      readFileSync(fileURLToPath(new URL("../fixtures/positive/blog/blog.json", import.meta.url)), "utf8"),
    ) as { input: unknown };
    expect(validate(blog.input), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("a patternRef with category-tagged params built only from the contract validates", () => {
    // The falsifiable form of "Track 3 can construct valid params from the frozen
    // contract alone" — every slot kind (tokenRef/text/url/scalar) round-trips.
    const ir = {
      irVersion: 1,
      theme: { slug: "demo-theme", title: "Demo", wpVersionTarget: "6.6" },
      tokens: {},
      regions: [
        {
          kind: "template",
          name: "index",
          content: [
            {
              pattern: "hero-cover",
              params: {
                headline: { kind: "text", value: "Welcome" },
                cta: { kind: "url", value: "https://example.com" },
                bg: { kind: "tokenRef", value: "primary" },
                ratio: { kind: "scalar", value: 60 },
              },
            },
          ],
        },
      ],
    };
    expect(validate(ir), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

describe("published error contract", () => {
  it("error-format.md documents every shipped error code (no silent code drift)", () => {
    const md = readFileSync(contractFile("error-format.md"), "utf8");
    for (const code of ERROR_CODES) {
      expect(md, `error-format.md must document the ${code} code`).toContain(code);
    }
  });
});

describe("published prompt contract — input-stage trust boundary", () => {
  it("the reference template isolates user input in a delimited slot, separate from instructions", () => {
    const md = readFileSync(contractFile("prompt-contract.md"), "utf8");
    const open = "<user_description>";
    const close = "</user_description>";
    const placeholder = "{{USER_DESCRIPTION}}";

    const placeholderAt = md.indexOf(placeholder);
    expect(placeholderAt, "missing user placeholder").toBeGreaterThanOrEqual(0);
    // Exactly one user placeholder — a single injection point.
    expect(md.split(placeholder).length - 1, "exactly one user placeholder").toBe(1);

    // The placeholder is enclosed by a matching slot pair (the reference template),
    // robust to the doc also naming the tag in normative prose elsewhere.
    const openBefore = md.lastIndexOf(open, placeholderAt);
    const closeAfter = md.indexOf(close, placeholderAt);
    expect(openBefore, "user placeholder must follow an open slot tag").toBeGreaterThanOrEqual(0);
    expect(closeAfter, "user placeholder must precede a close slot tag").toBeGreaterThan(placeholderAt);
    // Enclosure is intact: no close between the open and the placeholder, and no
    // second open between the placeholder and the close.
    expect(md.slice(openBefore, placeholderAt).includes(close), "slot closed before the placeholder").toBe(false);
    expect(md.slice(placeholderAt, closeAfter).includes(open), "second slot opened inside the slot").toBe(false);
  });
});
