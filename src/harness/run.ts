// The WordPress Playground install/activate gate — driver side (origin §7.2, U10).
//
// Boots a headless WASM WordPress (pinned WP 6.6 / PHP 8.2), writes the assembled
// theme zip into the Playground vfs, installs + activates it, then runs the four
// runPHP assertions from blueprint.ts and returns a structured pass/fail result.
//
// This is the SLOW outer gate: a cold boot instantiates the WASM runtime, so the
// tests that use it live under tests/harness/** and run via `npm run test:slow`,
// kept out of the fast unit gate. Booting is split from install/assert so a test
// file can boot ONCE (beforeAll) and exercise many themes against it.
import { runCLI } from "@wp-playground/cli";

import {
  buildAssertionScript,
  buildInstallScript,
  parseGateOutput,
  ZIP_VFS_PATH,
  type GateFailure,
} from "./blueprint";

/** The result of running the gate against one installed theme. */
export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

// Pinned to match the theme's declared compatibility floor (style.css) and the
// real platform the brief targets.
const WP_VERSION = "6.6";
const PHP_VERSION = "8.2";

/** A booted Playground: run PHP, write files, and dispose when done. */
export interface Playground {
  /** Execute PHP and return its stdout as text. Throws on a non-zero exit. */
  runPhp(code: string): Promise<string>;
  /** Write raw bytes into the Playground vfs. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Shut the worker pool down. */
  dispose(): Promise<void>;
}

/**
 * Boot a headless WordPress Playground (WP 6.6 / PHP 8.2). The returned handle is
 * reusable across multiple install/assert cycles, which is how the test file
 * amortizes the cold-boot cost over every archetype + failing case.
 */
export async function bootPlayground(): Promise<Playground> {
  const server = await runCLI({
    command: "start",
    wp: WP_VERSION,
    php: PHP_VERSION,
    port: 0,
    skipBrowser: true,
    quiet: true,
  });
  const pg = server.playground;
  return {
    async runPhp(code: string): Promise<string> {
      const result = await pg.run({ code });
      return result.text;
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      await pg.writeFile(path, data);
    },
    async dispose(): Promise<void> {
      await server[Symbol.asyncDispose]();
    },
  };
}

/**
 * Install + activate a theme zip into a booted Playground. Throws if the install
 * step itself fails (a missing slug, a corrupt archive) — distinct from an
 * assertion failure, which is a normal gate result.
 */
export async function installTheme(
  pg: Playground,
  zip: Uint8Array,
  slug: string,
): Promise<void> {
  await pg.writeFile(ZIP_VFS_PATH, zip);
  const out = await pg.runPhp(buildInstallScript(slug));
  if (!out.includes("INSTALL_OK")) {
    throw new Error(`Theme install/activation failed for '${slug}': ${out.trim()}`);
  }
}

/** Run the four assertions against the currently-active theme. */
export async function assertActiveTheme(pg: Playground, slug: string): Promise<GateResult> {
  const out = await pg.runPhp(buildAssertionScript(slug));
  const failures = parseGateOutput(out);
  return { ok: failures.length === 0, failures };
}

/**
 * Convenience: boot, install+activate, assert, dispose — the whole gate for one
 * theme. Prefer bootPlayground + installTheme + assertActiveTheme in a test suite
 * that exercises several themes, to share one boot.
 */
export async function runInstallGate(zip: Uint8Array, slug: string): Promise<GateResult> {
  const pg = await bootPlayground();
  try {
    await installTheme(pg, zip, slug);
    return await assertActiveTheme(pg, slug);
  } finally {
    await pg.dispose();
  }
}
