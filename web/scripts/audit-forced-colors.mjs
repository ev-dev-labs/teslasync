#!/usr/bin/env node
/**
 * Phase-46 / Prompt 11 — Forced-colors / Windows High Contrast audit.
 *
 * Walks the critical-component allow-list below and fails when any of
 * the listed files lacks an explicit `forced-colors:` Tailwind variant
 * occurrence (registered in `tailwind.config.js`) or an
 * `@media (forced-colors: active)` block.
 *
 * Why this exists
 * ---------------
 * Windows users with the OS-level High Contrast / Aquatic / Contrast
 * Themes feature enabled (commonly low-vision users) browse the app in
 * a mode where the OS overrides foreground/background colours,
 * suppresses `box-shadow`, suppresses background images, and treats
 * `border-color: transparent` as invisible. TeslaSync's UI uses many
 * `border-transparent`, glassmorphism backgrounds, and shadow-only
 * button boundaries — all of which vanish in forced-colors mode unless
 * we pin a system colour.
 *
 * The only reliable way to enforce that every shipped panel / chip /
 * toggle / dialog stays perceivable is to gate the critical-component
 * files with this audit. Pure layout primitives (Stack / Grid / Page
 * containers) are not in the allow-list — they have no chrome of their
 * own to remediate.
 *
 * Companion: see `web/src/index.css` for the global
 * `@media (forced-colors: active)` block that handles cross-cutting
 * concerns (focus rings, Recharts SVG axes, Leaflet vector overlays).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const CRITICAL_COMPONENTS = [
  'src/components/ui/Button.tsx',
  'src/components/ui/GlassPanel.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/Modal.tsx',
  'src/components/ui/Toggle.tsx',
  'src/components/ui/Tooltip.tsx',
  'src/components/ui/DataTable.tsx',
  'src/components/feedback/Toast.tsx',
  'src/components/charts/ChartContainer.tsx',
  'src/components/maps/MapLayerSwitcher.tsx',
];

// The Tailwind variant we register in `tailwind.config.js` produces
// `forced-colors:<utility>` class names. We accept either the variant
// directly or a raw `@media (forced-colors: active)` block (some
// callers may prefer raw CSS-in-JS or styled overrides).
const VARIANT_RE = /\bforced-colors:[\w[\]/#-]+/;
const MEDIA_RE = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)/;

const offenders = [];
const missing = [];

for (const rel of CRITICAL_COMPONENTS) {
  if (!existsSync(rel)) {
    missing.push(rel);
    continue;
  }
  const text = readFileSync(rel, 'utf8');
  const hasVariant = VARIANT_RE.test(text);
  const hasMedia = MEDIA_RE.test(text);
  if (!hasVariant && !hasMedia) {
    offenders.push(rel);
  }
}

if (missing.length > 0) {
  console.error(
    `\nforced-colors audit: ${missing.length} critical component file(s) ` +
      `listed in the audit allow-list do not exist. The audit list is out ` +
      `of date with the codebase — update CRITICAL_COMPONENTS in ` +
      `${join('scripts', 'audit-forced-colors.mjs')} to match the current ` +
      `component layout:`,
  );
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(
    `\nforced-colors audit: ${offenders.length} critical component(s) ` +
      `lack an explicit forced-colors override:`,
  );
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nFix by adding a `forced-colors:` Tailwind variant on the component\n' +
      'root (or its boundary element) so the panel/chip/button stays\n' +
      'perceivable in Windows High Contrast / Aquatic mode:\n' +
      '\n' +
      '  className={cn(\n' +
      '    \'border border-[var(--border-subtle)] bg-[var(--surface-2)]\',\n' +
      '    \'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]\',\n' +
      '  )}\n' +
      '\n' +
      'System colour vocabulary:\n' +
      '  Canvas, CanvasText      — page surface + text\n' +
      '  ButtonBorder, ButtonText — interactive control chrome\n' +
      '  Highlight, HighlightText — selected/focused state\n' +
      '  LinkText                — hyperlinks\n' +
      '\n' +
      'Alternatively, add a raw `@media (forced-colors: active)` block in\n' +
      'the same file when the override needs CSS that does not map cleanly\n' +
      'to a Tailwind class.\n' +
      '\n' +
      'See `web/src/index.css` for global rules (focus ring, Recharts axes,\n' +
      'Leaflet polylines) that already cover the cross-cutting concerns.',
  );
  process.exit(1);
}

console.log(
  `OK — every critical component (${CRITICAL_COMPONENTS.length}) ` +
    `defines a forced-colors override`,
);
