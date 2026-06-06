// Shared helpers for the design-token generators.
// Loads tokens.json and provides deterministic color/format utilities so the
// Fluent / Material 3 / HIG emitters produce byte-stable output.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = join(here, '..', '..'); // apps/design
export const TOKENS_PATH = join(ROOT, 'tokens.json');
export const GENERATED_DIR = join(ROOT, 'generated');

export function loadTokens() {
  return JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
}

// Auto-generated banner. The relative source keeps the warning identical across
// machines (no absolute paths leaking into generated output).
export const BANNER_LINES = [
  'AUTO-GENERATED from apps/design/tokens.json by apps/design/generators.',
  'DO NOT EDIT BY HAND. Run apps/design/generators/gen-themes.ps1 to regenerate.',
  'Drift is enforced by the --check gate (gen-themes.ps1 -Check).',
];

// ── Color parsing ─────────────────────────────────────────────────────────────
// Accepts "#rgb", "#rrggbb", and "rgb()/rgba()" and normalizes to {r,g,b,a}.

export function parseColor(value) {
  const v = String(value).trim();
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) throw new Error(`bad hex color: ${value}`);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) throw new Error(`unsupported color: ${value}`);
  return {
    r: Math.round(Number(m[1])),
    g: Math.round(Number(m[2])),
    b: Math.round(Number(m[3])),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
const alphaHex = (a) => Math.max(0, Math.min(255, Math.round(a * 255))).toString(16).padStart(2, '0').toUpperCase();

// 6-digit #RRGGBB (alpha discarded). Use for opaque-only sinks.
export function toHexRGB(value) {
  const { r, g, b } = parseColor(value);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// 8-digit #AARRGGBB — WPF/XAML brush format (alpha first).
export function toHexARGB(value) {
  const { r, g, b, a } = parseColor(value);
  return `#${alphaHex(a)}${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// Android/Compose 0xAARRGGBB color literal.
export function toComposeColor(value) {
  const { r, g, b, a } = parseColor(value);
  return `0x${alphaHex(a)}${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// SwiftUI Color(.sRGB) component tuple (0..1, 3 decimals, deterministic).
export function toSwiftComponents(value) {
  const { r, g, b, a } = parseColor(value);
  const f = (n) => (n / 255).toFixed(3);
  return { red: f(r), green: f(g), blue: f(b), opacity: a.toFixed(3) };
}

export const MODES = ['light', 'dark', 'highContrast'];
export const STATUS_KEYS = ['success', 'warning', 'danger', 'info'];
export const TYPE_ROLES = ['display', 'title', 'section', 'panel', 'body', 'bodySm', 'caption', 'label'];

// Capitalize first letter — used for platform identifier casing.
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
