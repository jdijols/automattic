// T4-U4 — guards the Vercel deploy config so a malformed edit fails the fast gate
// rather than surfacing only at deploy time. Asserts vercel.json is valid, targets
// Next.js, and gives the generate route enough wall-clock to cover the §7.3 latency
// budget (p95 ≤ 90s) plus assembly; and that the env template documents the
// server-only key without ever committing a real value.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repo = (...s: string[]): string => resolve(process.cwd(), ...s);
const read = (rel: string): string => readFileSync(repo(rel), "utf8");

describe("vercel.json (T4-U4)", () => {
  const config = JSON.parse(read("vercel.json")) as {
    framework?: string;
    functions?: Record<string, { maxDuration?: number }>;
  };

  it("targets the Next.js framework", () => {
    expect(config.framework).toBe("nextjs");
  });

  it("gives the generate route a maxDuration covering the p95 latency budget (90s) + assembly", () => {
    const fn = config.functions?.["app/api/generate/route.ts"];
    expect(fn).toBeDefined();
    expect(fn!.maxDuration).toBeGreaterThanOrEqual(90);
  });
});

describe(".env.example (T4-U4)", () => {
  const env = read(".env.example");

  it("documents the required server-only ANTHROPIC_API_KEY", () => {
    expect(env).toMatch(/^ANTHROPIC_API_KEY=/m);
  });

  it("ships no real key value — the variable is left blank for the operator to fill", () => {
    const line = env.split("\n").find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    expect(line).toBe("ANTHROPIC_API_KEY=");
    expect(env).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
