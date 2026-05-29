// T3-U10 — the Track-3 server seam (created here; `app/` was a bare client page).
// This route runs SERVER-SIDE only: the single `ANTHROPIC_API_KEY` is read by the
// AI provider inside `generateTheme` (server), is never referenced in this file,
// and is never returned to the client. CI runs with no live key (tests mock the
// provider); a separate key is used for any live deployment.
//
// The request passes the T3-U10 boundary — throttle → input cap → spend guard →
// generate — with provider errors credential-scrubbed before logging. See
// `src/orchestration/limits.ts` for the guard logic (unit-tested in isolation).
import { generateTheme } from "@/orchestration/index";
import { RateLimiter, SpendGuard, handleGenerateRequest } from "@/orchestration/limits";

// Module-scoped guards: one set per server instance.
const rateLimiter = new RateLimiter(30, 60_000); // 30 requests/minute/client
const spendGuard = new SpendGuard(1000); // bounded provider budget per instance lifetime

export async function POST(request: Request): Promise<Response> {
  const clientId =
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "anonymous";
  const rawBody: unknown = await request.json().catch(() => null);

  const result = await handleGenerateRequest(rawBody, {
    clientId,
    rateLimiter,
    spendGuard,
    generate: (input) => generateTheme(input),
  });

  // `result.log` (if present) is already credential-scrubbed — safe to emit. We
  // never include provider metadata in the response body.
  if (result.log) console.error(JSON.stringify(result.log));
  return Response.json(result.body, { status: result.status });
}
