// Compile design tokens (the IR `tokens` set) into a theme.json object
// (origin §3). Emits version 3. Crucially, when a custom preset reuses a core
// slug, v3 SILENTLY DROPS it unless the matching default-disable flag is set
// (origin §3.2) — so the compiler emits `settings.typography.defaultFontSizes:
// false` / `settings.spacing.defaultSpacingSizes: false` whenever a token reuses
// a core slug. Token VALUE validation (hex/size injection) lives in the layer-3
// validator, not here.
import { type DesignTokens } from "../ir/schema";

// Core preset slugs whose reuse triggers the v3 silent-drop unless defaults are
// disabled (origin §3.2). Shared with the layer-3 reuse check. WordPress applies
// the SAME silent-drop to all three preset categories — color included.
export const CORE_FONT_SIZE_SLUGS = new Set(["small", "medium", "large", "x-large", "xx-large"]);
export const CORE_SPACING_SLUGS = new Set(["20", "30", "40", "50", "60", "70", "80"]);
export const CORE_COLOR_SLUGS = new Set([
  "black",
  "cyan-bluish-gray",
  "white",
  "pale-pink",
  "vivid-red",
  "luminous-vivid-orange",
  "luminous-vivid-amber",
  "light-green-cyan",
  "vivid-green-cyan",
  "pale-cyan-blue",
  "vivid-cyan-blue",
  "vivid-purple",
]);

interface Preset {
  slug: string;
  name: string;
}
interface ColorPreset extends Preset {
  color: string;
}
interface SizePreset extends Preset {
  size: string;
}

export interface ThemeJson {
  version: 3;
  settings: {
    color?: { palette: ColorPreset[]; defaultPalette?: false };
    typography?: { fontSizes: SizePreset[]; defaultFontSizes?: false };
    spacing?: { spacingSizes: SizePreset[]; defaultSpacingSizes?: false };
  };
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function compileThemeJson(tokens: DesignTokens): ThemeJson {
  const settings: ThemeJson["settings"] = {};

  if (tokens.colors && tokens.colors.length > 0) {
    settings.color = {
      palette: tokens.colors.map((c) => ({
        slug: c.slug,
        color: c.color,
        name: c.name ?? titleCase(c.slug),
      })),
    };
    if (tokens.colors.some((c) => CORE_COLOR_SLUGS.has(c.slug))) {
      settings.color.defaultPalette = false;
    }
  }

  if (tokens.fontSizes && tokens.fontSizes.length > 0) {
    settings.typography = {
      fontSizes: tokens.fontSizes.map((f) => ({
        slug: f.slug,
        size: f.size,
        name: f.name ?? titleCase(f.slug),
      })),
    };
    if (tokens.fontSizes.some((f) => CORE_FONT_SIZE_SLUGS.has(f.slug))) {
      settings.typography.defaultFontSizes = false;
    }
  }

  if (tokens.spacing && tokens.spacing.length > 0) {
    settings.spacing = {
      spacingSizes: tokens.spacing.map((s) => ({
        slug: s.slug,
        size: s.size,
        name: s.name ?? titleCase(s.slug),
      })),
    };
    if (tokens.spacing.some((s) => CORE_SPACING_SLUGS.has(s.slug))) {
      settings.spacing.defaultSpacingSizes = false;
    }
  }

  return { version: 3, settings };
}
