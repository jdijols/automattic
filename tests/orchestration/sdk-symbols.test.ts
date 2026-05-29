// T3-U1 FIRST TASK — verify the load-bearing SDK symbols exist at the pinned
// majors (ai@6.x, @ai-sdk/anthropic@3.x, zod@4.x). These are major versions that
// move fast and `node_modules` is not committed, so a renamed/moved symbol must
// fail at the gate, not silently at a live call. TWO mechanisms cover that:
//   • VALUE symbols (`generateObject`, `NoObjectGeneratedError`) are imported and
//     asserted at runtime here — a rename breaks `npm test` immediately.
//   • TYPE symbols (`RepairTextFunction`, `AnthropicProviderOptions` +
//     `structuredOutputMode`/`cacheControl`) are erased at runtime, so the typed
//     constructions below are verified by `npm run typecheck` (tsc), which runs
//     in the same CI gate — a rename fails compilation. `provider.ts` also USES
//     `experimental_repairText` (exercised end-to-end in provider.test.ts).
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { NoObjectGeneratedError, generateObject, type RepairTextFunction } from "ai";
import { describe, expect, it } from "vitest";

describe("load-bearing SDK symbols (fail loudly if renamed at the pinned major)", () => {
  it("ai.generateObject is callable", () => {
    expect(typeof generateObject).toBe("function");
  });

  it("ai.NoObjectGeneratedError is a class exposing the isInstance type guard", () => {
    expect(typeof NoObjectGeneratedError).toBe("function");
    expect(typeof NoObjectGeneratedError.isInstance).toBe("function");
  });

  it("ai.RepairTextFunction (the experimental_repairText option type) exists", () => {
    const repair: RepairTextFunction = async () => null;
    expect(typeof repair).toBe("function");
  });

  it("@ai-sdk/anthropic provider options expose structuredOutputMode and cacheControl", () => {
    // Type-level: this object would not compile if either field were renamed.
    const opts: AnthropicProviderOptions = {
      structuredOutputMode: "auto",
      cacheControl: { type: "ephemeral", ttl: "5m" },
    };
    expect(opts.structuredOutputMode).toBe("auto");
    expect(opts.cacheControl?.ttl).toBe("5m");
  });
});
