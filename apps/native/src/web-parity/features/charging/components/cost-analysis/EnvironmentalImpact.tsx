// Native parity port of
// web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx.
//
// The web EnvironmentalImpact renders a single green-glow GlassPanel headed by a
// Leaf icon + "Environmental Impact" title. When `coreStats` is non-null it shows
// three stacked sections:
//   1. a 2-column grid of green stat cards — co2SavedKg (kg CO₂ saved) and
//      treeEquiv (tree-years equivalent).
//   2. a surface-2 description panel with a Trees icon and a paragraph that
//      inlines two bold-green spans (co2SavedKg kg, treeEquiv).
//   3. a 3-column grid of secondary stats — gallonsEquiv (gallons avoided),
//      co2SavedKg/1000 (metric tons CO₂) and savings ($ saved total).
// When `coreStats` is null it shows a centered "No data" message (h-32).
//
// Native-safe substitutions (documented in the parity sidecar):
//   - web `@/components/ui` GlassPanel + glow="green" -> native GlassPanel card
//     shell with a green-tinted border (GREEN_BORDER) echoing the green glow.
//   - web `lucide-react` Leaf/Trees (DOM/SVG icons, text-green-400) -> leading
//     emoji glyphs 🍃 (Leaf) / 🌳 (Trees), matching the QuickMetrics/RoutePlayback
//     emoji precedent (no native icon dependency); the surrounding green theme +
//     value colours preserve the green intent the icon tint carried.
//   - web `@/lib/numberFormat` fmtNumber -> inlined native-safe fmtNumber
//     (safeNumber guard, en-US locale, DEFAULT_GLOBAL_PRECISION 2) mirroring the
//     web out-of-box defaults (the native parity layer has no settings store).
//   - web `react-i18next` useTranslation -> useNativeTranslationFallback() shim
//     (each web t(key, fallback) key + English default preserved verbatim).
//   - web `import type { CoreStats } from './types'` -> inlined local CoreStats
//     interface (identical to the web ./types shape); the native types sibling is
//     a separate conversion target.
//   - web Tailwind text colours preserved as literals: green-400 (#4ade80),
//     green-500/10 card bg (rgba(34,197,94,0.1)); text-white -> AppText primary
//     tone, text-[var(--text-muted)] -> tone="muted", text-[var(--text-secondary)]
//     -> tone="secondary", bg-[var(--surface-2)] -> colors.surfaceRaised.
//   - web inline bold-green <span>s inside the description <p> -> nested <AppText>
//     (RN supports nested Text) with weight="semibold" + green colour, the `{' '}`
//     inter-token whitespace preserved verbatim.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── inlined `./types` CoreStats ──────────────────────────────────────────── */

interface CoreStats {
  totalCost: number;
  totalEnergy: number;
  avgCostPerKwh: number;
  totalDuration: number;
  totalDistanceM: number;
  costPerDist: number;
  gasCost: number;
  savings: number;
  savingsPercent: number;
  co2SavedKg: number;
  treeEquiv: number;
  gallonsEquiv: number;
  count: number;
}

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ─────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

// Mirrors web `safeNumber`: finite number or 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── web Tailwind colours preserved as literals ───────────────────────────── */

const GREEN_400 = '#4ade80'; // text-green-400
const GREEN_CARD_BG = 'rgba(34, 197, 94, 0.1)'; // bg-green-500/10
const GREEN_BORDER = 'rgba(34, 197, 94, 0.32)'; // glow="green" echo

/* ─── EnvironmentalImpact ──────────────────────────────────────────────────── */

interface EnvironmentalImpactProps {
  coreStats: CoreStats | null;
}

export function EnvironmentalImpact({coreStats}: EnvironmentalImpactProps) {
  const t = useNativeTranslationFallback();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <AppText style={styles.leafGlyph}>🍃</AppText>
        <AppText style={styles.title} weight="semibold">
          {t('costAnalysis.environment.title', 'Environmental Impact')}
        </AppText>
      </View>
      {coreStats ? (
        <View style={styles.body}>
          <View style={styles.cardGrid}>
            <View style={styles.card}>
              <AppText style={[styles.bigValue, styles.greenColor]} weight="bold">
                {fmtNumber(coreStats.co2SavedKg, 1)}
              </AppText>
              <AppText style={styles.cardLabel} tone="muted">
                {t('costAnalysis.environment.kgCo2', 'kg CO₂ saved')}
              </AppText>
            </View>
            <View style={styles.card}>
              <AppText style={[styles.bigValue, styles.greenColor]} weight="bold">
                {fmtNumber(coreStats.treeEquiv, 1)}
              </AppText>
              <AppText style={styles.cardLabel} tone="muted">
                {t('costAnalysis.environment.treeEquiv', 'tree-years equivalent')}
              </AppText>
            </View>
          </View>
          <View style={styles.descPanel}>
            <View style={styles.descRow}>
              <AppText style={styles.treeGlyph}>🌳</AppText>
              <AppText style={[styles.descText, styles.descFlex]} tone="secondary">
                {t(
                  'costAnalysis.environment.desc',
                  'By driving electric instead of a gas car, you have avoided the equivalent of',
                )}{' '}
                <AppText
                  style={[styles.descText, styles.greenColor]}
                  weight="semibold">
                  {`${fmtNumber(coreStats.co2SavedKg, 0)} kg`}
                </AppText>{' '}
                {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
                {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
                <AppText
                  style={[styles.descText, styles.greenColor]}
                  weight="semibold">
                  {fmtNumber(coreStats.treeEquiv, 1)}
                </AppText>{' '}
                {t(
                  'costAnalysis.environment.treesAbsorbing',
                  'trees absorbing carbon for a full year.',
                )}
              </AppText>
            </View>
          </View>
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <AppText style={styles.midValue} weight="semibold">
                {fmtNumber(coreStats.gallonsEquiv, 1)}
              </AppText>
              <AppText style={styles.smallLabel} tone="muted">
                {t('costAnalysis.environment.gallons', 'gallons avoided')}
              </AppText>
            </View>
            <View style={styles.statCell}>
              <AppText style={styles.midValue} weight="semibold">
                {fmtNumber(coreStats.co2SavedKg / 1000, 2)}
              </AppText>
              <AppText style={styles.smallLabel} tone="muted">
                {t('costAnalysis.environment.metricTons', 'metric tons CO₂')}
              </AppText>
            </View>
            <View style={styles.statCell}>
              <AppText style={styles.midValue} weight="semibold">
                {fmtNumber(coreStats.savings, 0)}
              </AppText>
              <AppText style={styles.smallLabel} tone="muted">
                {t('costAnalysis.environment.dollarsSaved', '$ saved total')}
              </AppText>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <AppText style={styles.emptyText} tone="muted">
            {t('costAnalysis.environment.noData', 'No data')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

EnvironmentalImpact.displayName = 'EnvironmentalImpact';

const styles = StyleSheet.create({
  bigValue: {
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
  },
  body: {
    gap: spacing.lg,
  },
  card: {
    alignItems: 'center',
    backgroundColor: GREEN_CARD_BG,
    borderRadius: 8,
    flex: 1,
    padding: spacing.lg,
  },
  cardGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardLabel: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  descFlex: {
    flex: 1,
  },
  descPanel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    padding: spacing.md,
  },
  descRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  descText: {
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 128,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  greenColor: {
    color: GREEN_400,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  leafGlyph: {
    fontSize: 14,
    lineHeight: 20,
  },
  midValue: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  panel: {
    borderColor: GREEN_BORDER,
    padding: spacing.lg,
  },
  smallLabel: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
  },
  statGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
  treeGlyph: {
    fontSize: 18,
    lineHeight: 24,
    marginTop: 2,
  },
});
