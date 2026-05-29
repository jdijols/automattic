// The WordPress Playground install/activate gate — PHP side (origin §7.2, U10).
//
// This module is pure string construction: it builds the PHP that installs +
// activates the theme zip and the PHP that runs the four correctness assertions
// the platform itself will not surface. Keeping it free of the Playground runtime
// makes the PHP unit-testable (shape, slug escaping, marker protocol) without
// booting WASM, and keeps run.ts focused on driving the runtime.
//
// The four assertions (origin §7.2), each a render-time check the static
// layers 1–4 cannot make:
//   1. activation clean — wp_get_theme()->errors() === false AND the active
//      stylesheet is the theme slug.
//   2. block resolution — for every templates/*.html + parts/*.html, parse_blocks
//      and walk: every non-null blockName is registered, none is core/html, and
//      there is NO non-whitespace null-name chunk (undelimited raw HTML — the
//      Bossenger failure mode the layer-4 byte scan would miss; this is its
//      render-time complement, a backstop against a U8 serializer bug or a
//      malformed pattern blob, not an IR-reachable attack).
//   3. theme.json no dropped keys — WP_Theme_JSON($raw,'theme')->get_raw_data()
//      vs the decoded file; every input key path must survive (presets compared
//      by slug so reordering is not a false drop).
//   4. navigation renders non-empty — render every template/part; any
//      core/navigation in the RENDERED output (after wp:pattern expansion, so the
//      blob-aware footer path is covered) must have non-empty inner content.
//
// Results cross the PHP→JS boundary as a single JSON object between two unique
// markers, so WordPress notices/warnings in stdout cannot corrupt parsing.
import { assertSafeSlug } from "../assembler/escaping";

/** Which of the four gate assertions a failure belongs to. */
export type GateCheck = "activation" | "block-resolution" | "theme-json-keys" | "navigation";

/** One structured gate failure (the harness's analogue of a §5.2 validator error). */
export interface GateFailure {
  check: GateCheck;
  message: string;
  detail?: string;
}

/** Markers delimiting the JSON result in PHP stdout (kept unique + grep-proof). */
export const GATE_BEGIN = "<<<GATE_RESULT_BEGIN>>>";
export const GATE_END = "<<<GATE_RESULT_END>>>";

/** Where run.ts writes the theme zip inside the Playground vfs before install. */
export const ZIP_VFS_PATH = "/tmp/theme-under-test.zip";

/**
 * PHP that installs the zip already written to ZIP_VFS_PATH and activates the
 * theme. unzip_file extracts the `<slug>/` root into wp-content/themes, exactly
 * as the WordPress theme installer would — so this genuinely exercises the
 * assembled archive, not a side-loaded file tree. Echoes `INSTALL_OK` on success
 * or `INSTALL_ERR:<message>` so run.ts can fail fast before asserting.
 */
export function buildInstallScript(slug: string): string {
  assertSafeSlug(slug, "theme slug");
  return `<?php
require '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
WP_Filesystem();
$res = unzip_file('${ZIP_VFS_PATH}', WP_CONTENT_DIR . '/themes');
if (is_wp_error($res)) { echo 'INSTALL_ERR:' . $res->get_error_message(); exit; }
switch_theme('${slug}');
if (get_stylesheet() !== '${slug}') { echo 'INSTALL_ERR:activation did not switch to ${slug}'; exit; }
echo 'INSTALL_OK';
`;
}

/**
 * PHP that runs the four assertions against the active theme and prints a JSON
 * `{ "failures": [...] }` between the markers. The slug is charset-validated, so
 * single-quote interpolation into PHP is safe (no quote/backslash can appear).
 */
export function buildAssertionScript(slug: string): string {
  assertSafeSlug(slug, "theme slug");
  return `<?php
require '/wordpress/wp-load.php';
$failures = array();

// --- Assertion 1: activation clean -----------------------------------------
$theme = wp_get_theme();
if (get_stylesheet() !== '${slug}') {
  $failures[] = array('check' => 'activation', 'message' => 'active stylesheet is not the theme slug', 'detail' => get_stylesheet());
}
$err = $theme->errors();
if ($err !== false) {
  $failures[] = array('check' => 'activation', 'message' => 'theme reports load errors', 'detail' => implode('; ', $err->get_error_messages()));
}

$dir = get_stylesheet_directory();

// --- Assertion 2: block resolution + undelimited-chunk scan -----------------
$registry = WP_Block_Type_Registry::get_instance();
$scan = function ($blocks, $file) use (&$scan, &$failures, $registry) {
  foreach ($blocks as $b) {
    $name = $b['blockName'];
    if ($name === null) {
      if (trim($b['innerHTML']) !== '') {
        $failures[] = array('check' => 'block-resolution', 'message' => 'undelimited non-whitespace chunk (raw HTML with no block delimiter)', 'detail' => $file . ': ' . substr(trim($b['innerHTML']), 0, 80));
      }
    } else if ($name === 'core/html') {
      $failures[] = array('check' => 'block-resolution', 'message' => 'Custom HTML block present (the disqualifying constraint)', 'detail' => $file);
    } else if (!$registry->is_registered($name)) {
      $failures[] = array('check' => 'block-resolution', 'message' => 'block name does not resolve to a registered block', 'detail' => $file . ': ' . $name);
    }
    if (!empty($b['innerBlocks'])) { $scan($b['innerBlocks'], $file); }
  }
};
foreach (array('templates', 'parts') as $sub) {
  $matches = glob($dir . '/' . $sub . '/*.html');
  if ($matches) {
    foreach ($matches as $f) { $scan(parse_blocks(file_get_contents($f)), $sub . '/' . basename($f)); }
  }
}

// --- Assertion 3: theme.json no dropped keys -------------------------------
$is_list = function ($a) {
  return is_array($a) && $a !== array() && array_keys($a) === range(0, count($a) - 1);
};
$missing = function ($in, $out, $prefix) use (&$missing, $is_list) {
  $miss = array();
  if ($is_list($in)) {
    // A list of presets: a key survives if a same-slug entry exists in output
    // (order is not significant, so index-based diffing would false-positive).
    // EXCLUDE the v2->v3 migration relocation: WP_Theme_JSON re-homes a preset
    // list under origin keys (fontSizes:[...] becomes fontSizes:{theme:[...]}),
    // so flatten any origin-keyed output back to a single list before comparing.
    $out_items = array();
    if ($is_list($out)) {
      $out_items = $out;
    } else if (is_array($out)) {
      foreach (array('theme', 'custom', 'default', 'base') as $origin) {
        if (isset($out[$origin]) && is_array($out[$origin])) {
          $out_items = array_merge($out_items, $out[$origin]);
        }
      }
    }
    foreach ($in as $item) {
      if (is_array($item) && isset($item['slug'])) {
        $found = false;
        foreach ($out_items as $o) {
          if (is_array($o) && isset($o['slug']) && $o['slug'] === $item['slug']) { $found = true; break; }
        }
        if (!$found) { $miss[] = $prefix . '[slug=' . $item['slug'] . ']'; }
      }
    }
    return $miss;
  }
  foreach ($in as $k => $v) {
    if (!is_array($out) || !array_key_exists($k, $out)) { $miss[] = $prefix . '.' . $k; continue; }
    if (is_array($v)) { $miss = array_merge($miss, $missing($v, $out[$k], $prefix . '.' . $k)); }
  }
  return $miss;
};
$tj_path = $dir . '/theme.json';
if (file_exists($tj_path)) {
  $raw = json_decode(file_get_contents($tj_path), true);
  if (is_array($raw)) {
    $obj = new WP_Theme_JSON($raw, 'theme');
    $out = $obj->get_raw_data();
    $dropped = $missing(isset($raw['settings']) ? $raw['settings'] : array(), isset($out['settings']) ? $out['settings'] : array(), 'settings');
    foreach ($dropped as $path) {
      $failures[] = array('check' => 'theme-json-keys', 'message' => 'theme.json key dropped by WordPress on load', 'detail' => $path);
    }
  }
}

// --- Assertion 4: navigation renders non-empty -----------------------------
// Render each template/part on the FRONTEND (do_blocks expands wp:pattern, so a
// nav that lives only inside the footer pattern blob is covered). Any rendered
// core/navigation must have non-empty inner content.
foreach (array('templates', 'parts') as $sub) {
  $matches = glob($dir . '/' . $sub . '/*.html');
  if ($matches) {
    foreach ($matches as $f) {
      $rendered = do_blocks(file_get_contents($f));
      if (preg_match_all('/<nav\\b[^>]*class="[^"]*wp-block-navigation[^"]*"[^>]*>(.*?)<\\/nav>/s', $rendered, $ms)) {
        foreach ($ms[1] as $inner) {
          if (trim(strip_tags($inner)) === '') {
            $failures[] = array('check' => 'navigation', 'message' => 'core/navigation renders empty (no menu, no page-list fallback)', 'detail' => $sub . '/' . basename($f));
          }
        }
      }
    }
  }
}

echo '${GATE_BEGIN}' . json_encode(array('failures' => $failures)) . '${GATE_END}';
`;
}

/**
 * Extract the gate failures from PHP stdout. Throws if the markers are missing
 * (a boot/PHP error rather than a clean assertion result) so the caller never
 * mistakes a crashed run for a passing one.
 */
export function parseGateOutput(stdout: string): GateFailure[] {
  const start = stdout.indexOf(GATE_BEGIN);
  const end = stdout.indexOf(GATE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Gate produced no parseable result (markers missing) — PHP likely errored. Raw output:\n${stdout.slice(0, 2000)}`,
    );
  }
  const json = stdout.slice(start + GATE_BEGIN.length, end);
  const parsed = JSON.parse(json) as { failures?: GateFailure[] };
  return parsed.failures ?? [];
}
