import { describe, expect, it, vi } from "vitest";

import { type IRValidated } from "../../src/validator";
import { type GenerationResult } from "../../src/orchestration/contract";
import {
  INPUT_MAX_LENGTH,
  RateLimiter,
  SpendGuard,
  handleGenerateRequest,
  sanitizeForLog,
} from "../../src/orchestration/limits";

const DONE: GenerationResult = { status: "done", ir: { regions: [] } as unknown as IRValidated };

function deps(over: Partial<Parameters<typeof handleGenerateRequest>[1]> = {}) {
  return {
    clientId: "client-1",
    rateLimiter: new RateLimiter(100, 60_000),
    spendGuard: new SpendGuard(100),
    generate: vi.fn(async () => DONE),
    ...over,
  };
}

describe("RateLimiter", () => {
  it("rejects once the per-window cap is hit, and recovers after the window", () => {
    let t = 0;
    const limiter = new RateLimiter(2, 1000, () => t);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false); // capped
    expect(limiter.tryAcquire("b")).toBe(true); // independent key
    t = 1001; // window elapsed
    expect(limiter.tryAcquire("a")).toBe(true);
  });

  it("evicts expired keys when the tracking map overflows (spoofed-key memory bound)", () => {
    let t = 0;
    const limiter = new RateLimiter(1, 1000, () => t, 2); // maxKeys=2
    for (let i = 0; i < 6; i += 1) limiter.tryAcquire(`forged-${i}`); // many distinct keys
    expect(limiter.trackedKeys).toBeGreaterThan(2);
    t = 2000; // all prior keys now expired
    limiter.tryAcquire("fresh"); // size>maxKeys → sweep evicts the expired forged keys
    expect(limiter.trackedKeys).toBeLessThanOrEqual(2);
  });
});

describe("SpendGuard", () => {
  it("fails closed once the bounded budget is exceeded", () => {
    const guard = new SpendGuard(2);
    expect(guard.tryReserve()).toBe(true);
    expect(guard.tryReserve()).toBe(true);
    expect(guard.tryReserve()).toBe(false); // fail closed
    expect(guard.remaining).toBe(0);
  });
});

describe("sanitizeForLog", () => {
  it("scrubs an Authorization Bearer token from an error", () => {
    const out = sanitizeForLog(new Error("401: Authorization: Bearer sk-leak-9"));
    expect(JSON.stringify(out)).not.toContain("sk-leak-9");
  });

  it("scrubs a bare API-key-shaped token even with no preceding label", () => {
    const out = sanitizeForLog(new Error("Invalid credentials: sk-ant-api03-bareleak123"));
    expect(JSON.stringify(out)).not.toContain("bareleak123");
  });
});

describe("handleGenerateRequest — Track-3 server-seam boundary (T3-U10)", () => {
  it("rejects over-length input BEFORE prompt construction (generate never called)", async () => {
    const d = deps();
    const result = await handleGenerateRequest({ userDescription: "x".repeat(INPUT_MAX_LENGTH + 1) }, d);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "input_too_long", maxLength: INPUT_MAX_LENGTH });
    expect(d.generate).not.toHaveBeenCalled(); // prompt assembly is never reached
  });

  it("throttles over-rate requests with 429, without calling generate", async () => {
    const d = deps({ rateLimiter: new RateLimiter(1, 60_000) });
    expect((await handleGenerateRequest({ userDescription: "build a blog" }, d)).status).toBe(200);
    const throttled = await handleGenerateRequest({ userDescription: "build a blog" }, d);
    expect(throttled.status).toBe(429);
    expect(throttled.body).toMatchObject({ error: "rate_limited" });
    expect(d.generate).toHaveBeenCalledTimes(1); // the throttled request did not generate
  });

  it("fails closed (503) once the spend budget is exhausted", async () => {
    const d = deps({ spendGuard: new SpendGuard(1) });
    expect((await handleGenerateRequest({ userDescription: "a" }, d)).status).toBe(200);
    const overspend = await handleGenerateRequest({ userDescription: "a" }, d);
    expect(overspend.status).toBe(503);
    expect(overspend.body).toMatchObject({ error: "capacity_exhausted" });
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("refunds the spend reservation on a thrown (non-billable) failure — no self-DoS", async () => {
    const guard = new SpendGuard(1);
    const throwing = deps({
      spendGuard: guard,
      generate: vi.fn(async () => {
        throw new Error("transient 401");
      }),
    });
    expect((await handleGenerateRequest({ userDescription: "a" }, throwing)).status).toBe(502);
    expect(guard.remaining).toBe(1); // budget restored — a forced 502 cannot drain it
    // A subsequent legitimate request still gets through.
    expect((await handleGenerateRequest({ userDescription: "a" }, deps({ spendGuard: guard }))).status).toBe(200);
  });

  it("keeps the debit when the provider ran (a 422 validation failure is billable)", async () => {
    const guard = new SpendGuard(1);
    const failed: GenerationResult = {
      status: "failed",
      errors: [{ code: "BLOCK_NOT_ALLOWED", layer: "block-tree", path: "p", message: "m", invariant: null }],
    };
    expect((await handleGenerateRequest({ userDescription: "a" }, deps({ spendGuard: guard, generate: vi.fn(async () => failed) }))).status).toBe(422);
    expect(guard.remaining).toBe(0); // the provider ran → spend kept
  });

  it("rejects oversized/hostile criteria with 400 at the boundary, before generation", async () => {
    const d = deps();
    const overEnum = await handleGenerateRequest({ userDescription: "ok", criteria: { siteType: "spaceship" } }, d);
    expect(overEnum.status).toBe(400);
    expect(overEnum.body).toMatchObject({ error: "invalid_criteria" });
    const extraKeys = await handleGenerateRequest({ userDescription: "ok", criteria: { junk: "x".repeat(100000) } }, deps());
    expect(extraKeys.status).toBe(400); // strictObject rejects the unknown key — bounded here, not in the provider
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("sanitizes a provider 401 carrying request metadata — no Authorization reaches body or log", async () => {
    const d = deps({
      generate: vi.fn(async () => {
        throw new Error("Provider 401 — Authorization: Bearer sk-secret-abc; x-api-key=sk-secret-abc");
      }),
    });
    const result = await handleGenerateRequest({ userDescription: "build a blog" }, d);
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "generation_failed" }); // generic — no metadata
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-secret-abc");
    expect(serialized).not.toContain("Bearer sk-secret");
  });

  it("returns 200 with the validated IR on success", async () => {
    const result = await handleGenerateRequest({ userDescription: "build a blog" }, deps());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "done" });
  });

  it("returns 422 with the legible §5.2 error list on a failed generation", async () => {
    const failed: GenerationResult = {
      status: "failed",
      errors: [{ code: "BLOCK_NOT_ALLOWED", layer: "block-tree", path: "p", message: "m", invariant: null }],
    };
    const result = await handleGenerateRequest({ userDescription: "x" }, deps({ generate: vi.fn(async () => failed) }));
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ status: "failed" });
  });

  it("rejects a malformed body with 400 before any generation", async () => {
    const d = deps();
    const result = await handleGenerateRequest({ notADescription: true }, d);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_request" });
    expect(d.generate).not.toHaveBeenCalled();
  });
});
