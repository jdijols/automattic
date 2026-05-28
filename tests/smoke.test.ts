import { describe, expect, it } from "vitest";

import { PLACEHOLDER } from "../src/index";

// The smoke test only proves the test harness runs on a clean clone (R8 —
// zero setup friction). Real behavioral tests land per-unit from U2 onward.
describe("smoke", () => {
  it("runs the vitest harness", () => {
    expect(true).toBe(true);
  });

  it("can import the package entry", () => {
    expect(PLACEHOLDER).toBe(true);
  });
});
