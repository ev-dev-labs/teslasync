/**
 * Phase-46 / Prompt 11 — Forced-colors contract tests.
 *
 * The shared critical components (Button, GlassPanel, Card, Badge,
 * Modal, Toggle, Tooltip, DataTable, Toast, ChartContainer,
 * MapLayerSwitcher) MUST carry an explicit `forced-colors:` Tailwind
 * variant on at least one of their root or boundary elements so the
 * panel/chip/dialog/button stays perceivable in Windows High Contrast /
 * Aquatic / Contrast Themes mode.
 *
 * `npm run audit:forced-colors` enforces this at lint-time by scanning
 * the same critical-component allow-list. This file is the
 * defense-in-depth equivalent — it re-runs the same allow-list as a
 * Vitest spec so a future refactor that strips the override out of one
 * of these files trips both gates loudly.
 *
 * The audit lives in `web/scripts/audit-forced-colors.mjs`. Keep the
 * `CRITICAL_COMPONENTS` list below in sync if you ever add or rename
 * a critical component.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
] as const;

const VARIANT_RE = /\bforced-colors:[\w[\]/#-]+/;
const MEDIA_RE = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)/;

describe('Forced-colors contract — critical components', () => {
  it.each(CRITICAL_COMPONENTS)(
    '%s carries an explicit forced-colors override',
    (rel) => {
      expect(existsSync(rel)).toBe(true);
      const text = readFileSync(rel, 'utf8');
      const hasVariant = VARIANT_RE.test(text);
      const hasMedia = MEDIA_RE.test(text);
      if (!hasVariant && !hasMedia) {
        throw new Error(
          `${rel} does not contain a \`forced-colors:\` Tailwind variant ` +
            `nor an \`@media (forced-colors: active)\` block. Without one, ` +
            `the component vanishes in Windows High Contrast mode. See ` +
            `web/scripts/audit-forced-colors.mjs for remediation guidance.`,
        );
      }
      expect(hasVariant || hasMedia).toBe(true);
    },
  );

  it('global index.css ships a forced-colors media block (focus / Recharts / Leaflet)', () => {
    const css = readFileSync(join('src', 'index.css'), 'utf8');
    expect(MEDIA_RE.test(css)).toBe(true);
    // Spot-check the cross-cutting overrides we promise are present:
    // a Highlight focus ring, recharts axis stroke, and at least one
    // [data-print-card] panel border.
    expect(css).toMatch(/outline:\s*2px solid Highlight/);
    expect(css).toMatch(/recharts-cartesian-grid/);
    expect(css).toMatch(/\[data-print-card\]/);
  });
});

describe('Forced-colors contract — Tailwind variant registration', () => {
  it('tailwind.config.js registers the forced-colors variant via plugin', () => {
    const cfg = readFileSync('tailwind.config.js', 'utf8');
    // Either the explicit addVariant call we added, or the literal
    // `@media (forced-colors: active)` template, or the plain
    // `forced-colors` variant string — any of these proves the
    // registration is in place.
    const hasAddVariant = /addVariant\(\s*['"]forced-colors['"]/.test(cfg);
    const hasMediaLiteral = MEDIA_RE.test(cfg);
    expect(hasAddVariant || hasMediaLiteral).toBe(true);
  });
});
