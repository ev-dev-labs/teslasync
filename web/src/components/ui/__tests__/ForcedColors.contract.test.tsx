/**
 * Forced-colors contract tests.
 * The shared critical components (Button, GlassPanel, Card, Badge,
 * Modal, Toggle, Tooltip, DataTable, Toast, ChartContainer,
 * MapLayerSwitcher) MUST carry an explicit `forced-colors:` Tailwind
 * variant on at least one of their root or boundary elements so the
 * panel/chip/dialog/button stays perceivable in Windows High Contrast /
 * Aquatic / Contrast Themes mode.
 * `npm run audit:forced-colors` enforces this at lint-time by scanning
 * the same critical-component allow-list. This file is the
 * defense-in-depth equivalent — it re-runs the same allow-list as a
 * Vitest spec so a future refactor that strips the override out of one
 * of these files trips both gates loudly.
 * The audit lives in `web/scripts/audit-forced-colors.mjs`. Keep the
 * `CRITICAL_COMPONENTS` list below in sync if you ever add or rename
 * a critical component.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Same resolver the CLI audit uses, imported rather than reimplemented
// so the build gate and this spec can never disagree about what
// "wins the cascade" means.
import {
  auditForcedColors,
  parseCssRules,
  resolveTokenWinner,
  readThemeProviderInline,
  matchesRoot,
  specificity,
  TOKEN_FALLBACKS,
  ELEVATION_TOKENS,
  THEME_STATES,
  // @ts-expect-error — plain ESM build script, no type declarations.
} from '../../../../scripts/audit-forced-colors.mjs';

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

  /**
   * A11Y-07 — design-token cascade.
   *
   * Almost every surface in the app is styled through CSS custom
   * properties, and `ThemeProvider` writes the live theme onto `<html>`
   * as INLINE style. An inline declaration outranks every normal author
   * rule regardless of specificity, so a plain
   * `:root { --surface-1: Canvas }` inside the forced-colors block is
   * inert at runtime — which is exactly the state the first version of
   * this suite passed on, because it only grepped for the token text.
   *
   * These assertions run the same cascade resolver the audit script
   * uses (imported, not re-implemented, so the two cannot drift) and
   * assert that the declaration which actually WINS is the
   * system-colour one.
   */
  describe('design-token cascade', () => {
    it('every audited token wins the cascade in both theme states', () => {
      const { cascadeOffenders } = auditForcedColors();
      expect(cascadeOffenders, cascadeOffenders.join('\n')).toEqual([]);
    });

    it('every critical component still carries an override', () => {
      const { offenders, missing } = auditForcedColors();
      expect(missing, `stale allow-list entries: ${missing.join(', ')}`).toEqual([]);
      expect(
        offenders,
        `missing forced-colors override: ${offenders.join(', ')}`,
      ).toEqual([]);
    });

    it('ThemeProvider never writes an audited token with important priority', () => {
      // An important INLINE declaration is unbeatable by any author
      // rule, so it would silently kill the whole remap.
      const { importantInline } = readThemeProviderInline(
        join('src', 'components', 'ui', 'ThemeProvider.tsx'),
      );
      const audited = new Set<string>([
        ...TOKEN_FALLBACKS.map(([token]: [string, string]) => token),
        ...ELEVATION_TOKENS,
      ]);
      const clashes = [...importantInline].filter((token) => audited.has(token));
      expect(clashes, `inline !important on: ${clashes.join(', ')}`).toEqual([]);
    });

    it('detects a token that loses to the inline theme value', () => {
      // Negative control: proves the resolver would catch the original
      // defect rather than passing vacuously. Patched in memory only.
      const css = readFileSync(join('src', 'index.css'), 'utf8').replace(
        '--surface-1: Canvas !important;',
        '--surface-1: Canvas;',
      );
      const rules = parseCssRules(css);
      const inline = new Set(['--surface-1']);
      for (const state of THEME_STATES) {
        const winner = resolveTokenWinner(rules, '--surface-1', state, inline);
        expect(winner.source).toBe('inline');
      }
    });

    it('detects a forced-colors selector that never matches <html>', () => {
      // `[data-theme]` is not a selector this app ever puts on the
      // document element — ThemeProvider toggles `.dark` / `.light-mode`.
      expect(matchesRoot('[data-theme]', ['dark'])).toBe(false);
      expect(matchesRoot(':root', ['dark'])).toBe(true);
      expect(matchesRoot(':root.light-mode', ['light-mode'])).toBe(true);
      expect(matchesRoot(':root.light-mode', ['dark'])).toBe(false);
    });

    it('ranks :root.light-mode above :root, as the browser does', () => {
      const bare = specificity(':root');
      const scoped = specificity(':root.light-mode');
      expect(scoped[1]).toBeGreaterThan(bare[1]);
    });
  });
});
