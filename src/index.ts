// Track 1 correctness backbone — package entry placeholder.
//
// Real exports land in later units:
//   U2 — block allowlist + containment grammar + attribute overlay
//   U3 — IR schema (Zod) + publishable JSON Schema
//   U4 — layered validator + structured error format
//   U5 — theme.json compilation + AJV (layer 3)
// This placeholder exists only so the toolchain (tsc, vitest, eslint) has a
// `src/` entry to compile on a clean clone.
export const PLACEHOLDER = true;
