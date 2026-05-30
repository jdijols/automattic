// @vitest-environment jsdom
//
// jsdom: the success path assembles a real theme via @wordpress/blocks, whose
// runtime needs window/document at import time (the same reason the assembler unit
// tests + tests/e2e run under jsdom). Under jsdom the assembler's dom-bootstrap is a
// no-op; under the default `node` env it throws on modern Node's read-only global
// `navigator`. NOTE: that same dom-bootstrap path is a real production-runtime gap
// for serving the .zip from a plain Node server — tracked for T4-U4 deploy-prep /
// a Track-2 dom-bootstrap fix; out of this unit's file domain (src/assembler/**).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { type GenerationResult } from "../../src/orchestration/contract";
import { type IRValidated } from "../../src/validator";

// Resolve repo paths from CWD, not import.meta.url: under the jsdom env (which this
// file needs — see the pragma above) import.meta.url is an http:// URL, so
// fileURLToPath would reject it. The e2e tests resolve from process.cwd() for the
// same reason.
const repo = (...s: string[]): string => resolve(process.cwd(), ...s);

// Mock the generation entry so the route never makes a live provider call.
const generateTheme = vi.fn<(input: unknown) => Promise<GenerationResult>>();
vi.mock("@/orchestration/index", () => ({ generateTheme: (input: unknown) => generateTheme(input) }));

// Imported AFTER the mock is registered (vi.mock is hoisted).
const { POST } = await import("../../app/api/generate/route");

// A real, validator-passing IR — the route assembles + zips this on success, so a
// stub like `{ regions: [] }` would (correctly) fail the strict irSchema bridge.
const blogFixture = JSON.parse(readFileSync(repo("fixtures/positive/blog/blog.json"), "utf8")) as {
  input: { theme: { slug: string } };
};
const validIR = blogFixture.input as unknown as IRValidated;

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/api/generate", { method: "POST", body: JSON.stringify(body), headers });

// The route lazily `await import("@/assembler/index")` on success (T4-U4, so the
// jsdom DOM bootstrap stays out of `next build` page-data collection). Warm that
// heavy module once here — @wordpress/blocks + registerCoreBlocks + the jsdom
// bootstrap cold-load otherwise lands inside the first success test's per-test
// timer and trips the 5s default. Warming it leaves the per-test timers honest.
beforeAll(async () => {
  await import("@/assembler/index");
}, 60_000);

afterEach(() => generateTheme.mockReset());

describe("POST /api/generate — success path returns the theme .zip (T4-U2)", () => {
  it("assembles the validated IR and returns a downloadable application/zip", async () => {
    generateTheme.mockResolvedValue({ status: "done", ir: validIR });
    const res = await POST(post({ userDescription: "A clean blog." }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${blogFixture.input.theme.slug}.zip"`,
    );

    // The body is real zip bytes (local-file-header magic "PK\x03\x04"), not JSON.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });

  it("exposes no key/provider metadata on the success response", async () => {
    generateTheme.mockResolvedValue({ status: "done", ir: validIR });
    const res = await POST(post({ userDescription: "A clean blog." }));
    expect(res.headers.get("content-type")).toBe("application/zip");
    // Headers carry only the filename — nothing secret.
    expect(res.headers.get("content-disposition")).not.toMatch(/sk-|Authorization|ANTHROPIC/);
  });
});

describe("POST /api/generate — non-success paths are byte-identical to T3-U10", () => {
  it("422 on a failed/validation result: the structured errors pass through as JSON, no zip", async () => {
    generateTheme.mockResolvedValue({
      status: "failed",
      errors: [{ code: "BLOCK_NOT_ALLOWED", layer: "block-tree", path: "regions[0]", message: "m", invariant: null }],
    } as unknown as GenerationResult);
    const res = await POST(post({ userDescription: "A clean blog." }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("turns a malformed (non-JSON) body into 400, not an unhandled 500", async () => {
    const res = await POST(new Request("http://localhost/api/generate", { method: "POST", body: "not json{" }));
    expect(res.status).toBe(400);
    expect(generateTheme).not.toHaveBeenCalled();
  });

  it("400 input_too_long for an over-cap description — before any generate/assemble call", async () => {
    const res = await POST(post({ userDescription: "x".repeat(4001) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "input_too_long" });
    expect(generateTheme).not.toHaveBeenCalled();
  });

  it("400 invalid_criteria for a hostile criteria object — before any generate/assemble call", async () => {
    const res = await POST(post({ userDescription: "A clean blog.", criteria: { palette: "not-an-object" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_criteria" });
    expect(generateTheme).not.toHaveBeenCalled();
  });

  it("429 rate_limited once a client exceeds the window — generic body, no zip", async () => {
    generateTheme.mockResolvedValue({
      status: "failed",
      errors: [{ code: "BLOCK_NOT_ALLOWED", layer: "block-tree", path: "", message: "m", invariant: null }],
    } as unknown as GenerationResult);
    const ip = "203.0.113.7"; // a fresh client so this doesn't touch the shared "anonymous" budget
    let last = await POST(post({ userDescription: "A clean blog." }, { "x-forwarded-for": ip }));
    for (let i = 0; i < 35 && last.status !== 429; i += 1) {
      last = await POST(post({ userDescription: "A clean blog." }, { "x-forwarded-for": ip }));
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });
  });

  it("maps a provider throw to a generic 502 with no metadata in the response", async () => {
    generateTheme.mockRejectedValue(new Error("Provider 401 — Authorization: Bearer sk-secret-xyz"));
    const res = await POST(post({ userDescription: "A clean blog." }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("sk-secret-xyz");
    expect(text).not.toContain("Authorization");
    expect(JSON.parse(text)).toEqual({ error: "generation_failed" });
  });
});

describe("secrets policy (T3-U10)", () => {
  it("the route module never references the API key (key is read server-side by the provider)", () => {
    const src = readFileSync(repo("app/api/generate/route.ts"), "utf8");
    // No code path READS the key (the doc comment may name it); the provider
    // reads ANTHROPIC_API_KEY server-side inside generateTheme.
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("page surface (T3-U10)", () => {
  it("the client page exposes no key read", () => {
    const src = readFileSync(repo("app/page.tsx"), "utf8");
    expect(src).not.toMatch(/process\.env|ANTHROPIC/);
  });
});
