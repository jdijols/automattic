// T3-U10 / T4-U2 — the Track-3 server seam (created here; `app/` was a bare client
// page). This route runs SERVER-SIDE only: the single `ANTHROPIC_API_KEY` is read
// by the AI provider inside `generateTheme` (server), is never referenced in this
// file, and is never returned to the client. CI runs with no live key (tests mock
// the provider); a separate key is used for any live deployment.
//
// The request passes the T3-U10 boundary — throttle → input cap → spend guard →
// generate — with provider errors credential-scrubbed before logging. See
// `src/orchestration/limits.ts` for the guard logic (unit-tested in isolation).
//
// T4-U2 wires the LAST mile: on a successful generation the validated IR is
// assembled into a byte-reproducible theme `.zip` and streamed back as a download.
// Every NON-success path (422 failed, 400 input_too_long/invalid_criteria/
// invalid_request, 429 rate_limited, 502 generation_failed, 503 capacity_exhausted)
// is left byte-identical: only the 200/`done` branch diverges from returning IR JSON.
import { assembleThemeZip } from "@/assembler/index";
import { irSchema } from "@/ir/schema";
import { generateTheme } from "@/orchestration/index";
import { RateLimiter, SpendGuard, handleGenerateRequest, sanitizeForLog } from "@/orchestration/limits";

// Pin the Node runtime (never Edge): the assembler bootstraps a jsdom DOM for
// @wordpress/blocks, so this path must run on Node. (Production-runtime caveat:
// jsdom is currently a devDependency and src/assembler/dom-bootstrap.ts assigns
// the read-only global `navigator` — both make the assembled-zip path fail on a
// production Node ≥21 / devDep-pruned install. Tracked for T4-U4 deploy-prep + a
// Track-2 dom-bootstrap fix; out of this unit's file domain.)
export const runtime = "nodejs";

// Module-scoped guards: one set per server instance.
const rateLimiter = new RateLimiter(30, 60_000); // 30 requests/minute/client
const spendGuard = new SpendGuard(1000); // bounded provider budget per instance lifetime

/** The success body the handler returns on a completed generation. */
function isDoneBody(body: unknown): body is { status: "done"; ir: unknown } {
  return typeof body === "object" && body !== null && (body as { status?: unknown }).status === "done";
}

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

  // `result.log` (if present) is already credential-scrubbed — safe to emit.
  if (result.log) console.error(JSON.stringify(result.log));

  // Success → assemble the validated IR and stream the .zip. The handler returns
  // the lenient IRValidated; `irSchema.parse` bridges it to the strict IR the
  // assembler consumes (the same bridge tests/e2e/pipeline.test.ts uses — total
  // here because the IR already cleared validateIR layers 1–3). The assembler runs
  // its own layer-4 byte scan and throws AssemblyError on any wp:html / hallucinated
  // block, so the disqualifying-constraint guard is never bypassed by this wiring.
  if (result.status === 200 && isDoneBody(result.body)) {
    try {
      const ir = irSchema.parse(result.body.ir);
      const zip = await assembleThemeZip(ir);
      // Re-back the bytes with a plain ArrayBuffer: assembleThemeZip returns
      // Uint8Array<ArrayBufferLike>, whose buffer could (per the type) be a
      // SharedArrayBuffer, so it does not satisfy the strict BodyInit type. A fresh
      // `new Uint8Array(zip)` is Uint8Array<ArrayBuffer> — a valid BufferSource that
      // Response streams verbatim (no Blob coercion, which mis-serializes here).
      const bytes = new Uint8Array(zip);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${ir.theme.slug}.zip"`,
          // Reproducible bytes — no surprise transforms/caching on a binary download.
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      // Assembly is the only step downstream of a validated IR; a failure here is
      // an internal fault, scrubbed and surfaced as the SAME generic shape a
      // provider error uses — never a stack trace or zip-internal detail.
      console.error(JSON.stringify({ event: "assembly_error", detail: sanitizeForLog(error) }));
      return Response.json({ error: "generation_failed" }, { status: 502 });
    }
  }

  // Every non-success path is unchanged: pass the handler's status + JSON body
  // through exactly as before. We never include provider metadata in the body.
  return Response.json(result.body, { status: result.status });
}
