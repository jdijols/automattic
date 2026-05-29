import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type GenerationResult } from "../../src/orchestration/contract";
import { type IRValidated } from "../../src/validator";

// Mock the generation entry so the route never makes a live provider call.
const generateTheme = vi.fn<(input: unknown) => Promise<GenerationResult>>();
vi.mock("@/orchestration/index", () => ({ generateTheme: (input: unknown) => generateTheme(input) }));

// Imported AFTER the mock is registered (vi.mock is hoisted).
const { POST } = await import("../../app/api/generate/route");

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/api/generate", { method: "POST", body: JSON.stringify(body), headers });

afterEach(() => generateTheme.mockReset());

describe("POST /api/generate — server seam (T3-U10)", () => {
  it("returns 200 with the validated IR on success, exposing no key/provider metadata", async () => {
    generateTheme.mockResolvedValue({ status: "done", ir: { regions: [] } as unknown as IRValidated });
    const res = await POST(post({ userDescription: "A clean blog." }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: "done" });
    expect(text).not.toMatch(/sk-|Authorization|ANTHROPIC_API_KEY/); // no secret reaches the client
  });

  it("turns a malformed (non-JSON) body into 400, not an unhandled 500", async () => {
    const res = await POST(new Request("http://localhost/api/generate", { method: "POST", body: "not json{" }));
    expect(res.status).toBe(400);
    expect(generateTheme).not.toHaveBeenCalled();
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
    const src = readFileSync(fileURLToPath(new URL("../../app/api/generate/route.ts", import.meta.url)), "utf8");
    // No code path READS the key (the doc comment may name it); the provider
    // reads ANTHROPIC_API_KEY server-side inside generateTheme.
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("page surface (T3-U10)", () => {
  it("the client page exposes no key read", () => {
    const src = readFileSync(fileURLToPath(new URL("../../app/page.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/process\.env|ANTHROPIC/);
  });
});
