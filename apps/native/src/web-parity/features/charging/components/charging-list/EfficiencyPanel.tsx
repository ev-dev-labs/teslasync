// Native parity port of
// web/src/features/charging/components/charging-list/EfficiencyPanel.tsx.
//
// The web source renders the "Charging Efficiency" summary panel for the
// charging list: a GlassPanel whose `.section-title` heading pairs a lucide
// `Activity` glyph (text-neon-green) with the title and a muted hint that names
// the wall-to-battery conversion and the `stats.count` session count, above a
// responsive grid (1 column, 2 at Tailwind `sm`, 4 at `lg`) of four nested
// GlassPanel tiles:
//   1. Average efficiency (cyan-300) + a neon-cyan progress bar clamped to 100%.
//   2. Best session efficiency (emerald-300) + the formatted session date.
//   3. Worst session efficiency (rose-300) + the formatted session date.
//   4. Wall-to-battery loss (amber-300, kWh) + a "used kWh -> added kWh" line.
// It composes react-i18next, the lucide `Activity` icon, the shared web
// GlassPanel, the `fmtNumber`/`fmtPercent`/`fmtWithUnit` number formatters, the
// `formatDateTime` date formatter, and the `EfficiencyStats` type from
// `./helpers`.
//
// None of those web modules are native-safe (react-i18next is not wired, lucide /
// the DOM grid / Tailwind / CSS vars are browser-only, and the native `./helpers`
// + `@/lib/numberFormat` + `@/lib/dateFormat` ports do not exist yet in this
// file-by-file loop), so -- mirroring the sibling SecurityStatistics port -- this
// self-contained port rebuilds each piece with React Native primitives and the
// existing native tokens/components:
//   * GlassPanel (native) takes a `style` instead of a `className`; the outer
//     `p-5` and the inner `p-5 text-center` tiles map to padding + centred items.
//   * The `Activity` glyph maps to the repo SemanticIcon `activity` ('AC') read
//     via getSemanticIconDefinition, rendered as a bare green glyph (the
//     `text-neon-green` colour intent) -- no lucide-react / DOM <svg> import.
//   * The Tailwind `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` becomes
//     a flex-wrap row whose per-cell percentage width follows the live viewport
//     width against the Tailwind sm (640px) / lg (1024px) breakpoints, using the
//     negative-margin gutter trick for the gap-4 (16px) spacing.
//   * `fmtNumber`/`fmtPercent`/`fmtWithUnit` are reproduced inline at the web
//     default precision (2) and global locale ('en-US'), with the same
//     `safeNumber` nullish/NaN -> 0 guard; `formatDateTime` is reproduced inline
//     with the same year/month/day/hour/minute fields and '—' fallback, using the
//     device locale (the web default when no override is supplied).
//   * react-i18next is replaced by a self-contained fallback that preserves every
//     i18n key and English fallback string.
//   * `EfficiencyStats` (imported from `./helpers` on the web) is mirrored as a
//     local interface because the native `./helpers` port does not exist yet; the
//     field set matches the web shape exactly. This is a pure presentational
//     component -- it renders the already-computed SI/derived values verbatim and
//     performs no unit conversion itself.
//
// No DOM, no lucide-react, no framer-motion, no Recharts/Leaflet, and no web UI
// components are imported.

import React, {useCallback} from 'react';
import {StyleSheet, View, useWindowDimensions} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for the title, hint, every tile label, and the
// "sessions with data" suffix.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the web `./helpers` `EfficiencyStats` export. The native
// helpers port does not exist yet in this file-by-file conversion loop, so the
// shape is reproduced here field-for-field to keep the port self-contained and
// type-checked.
interface EfficiencyStats {
  avgEfficiency: number;
  best: {id: number; date: string; efficiency: number; added: number; used: number};
  worst: {id: number; date: string; efficiency: number; added: number; used: number};
  wallLoss: number;
  totalAdded: number;
  totalUsed: number;
  count: number;
}

// --- Inlined `@/lib/numberFormat` parity ----------------------------------
// The web default global precision is 2 and the default global locale is
// 'en-US' (both set by useSettings, which native has not wired). Non-finite
// inputs coerce to 0 via `safeNumber`, exactly as the web formatters do.
const FMT_LOCALE = 'en-US';
const FMT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals: number = FMT_PRECISION): string {
  const d = Math.max(0, Math.min(20, decimals));
  return safeNumber(value).toLocaleString(FMT_LOCALE, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtPercent(value: unknown, decimals?: number): string {
  return `${fmtNumber(value, decimals)}%`;
}

function fmtWithUnit(value: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(value, decimals)} ${unit}`;
}

// --- Inlined `@/lib/dateFormat` `formatDateTime` parity --------------------
// "Apr 4, 2026, 03:45 PM": year/month/day/hour/minute, '—' for nullish/invalid,
// device locale (the web default when no timezone/locale override is supplied).
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Tile value colours: the web toned-down Tailwind `-300` hues.
const VALUE_CYAN = '#67e8f9'; // text-cyan-300
const VALUE_EMERALD = '#6ee7b7'; // text-emerald-300
const VALUE_ROSE = '#fda4af'; // text-rose-300
const VALUE_AMBER = '#fcd34d'; // text-amber-300
// `bg-neon-cyan` progress fill (rgb(0, 240, 255)).
const NEON_CYAN = '#00f0ff';

// gap-4 == 1rem == 16px, reproduced with the negative-margin gutter trick.
const GRID_GAP = 16;
const HALF_GAP = GRID_GAP / 2;

// Tailwind responsive grid: grid-cols-1 (base) -> sm:grid-cols-2 (640px) ->
// lg:grid-cols-4 (1024px).
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;

// Reproduces grid-cols-1 / sm:grid-cols-2 / lg:grid-cols-4 against the live
// viewport width.
function useGridColumns(): number {
  const {width} = useWindowDimensions();
  if (width >= LG_BREAKPOINT) {
    return 4;
  }
  if (width >= SM_BREAKPOINT) {
    return 2;
  }
  return 1;
}

// Lays children out in a responsive flex-wrap grid with gap-4 gutters (via the
// negative-margin trick), wrapping each child in a percentage-width cell.
function StatGrid({children}: {children: React.ReactNode}) {
  const columns = useGridColumns();

  return (
    <View style={styles.grid}>
      {React.Children.map(children, child => (
        <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
          {child}
        </View>
      ))}
    </View>
  );
}

// One nested GlassPanel tile (web `p-5 text-center`): a large coloured value, a
// muted label, and optional extra content (the progress bar, a date, or the
// used -> added line).
function MetricTile({
  value,
  valueColor,
  label,
  children,
}: {
  value: string;
  valueColor: string;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <GlassPanel style={styles.tile}>
      <AppText style={[styles.tileValue, {color: valueColor}]} weight="bold">
        {value}
      </AppText>
      <AppText style={styles.tileLabel} tone="muted">
        {label}
      </AppText>
      {children}
    </GlassPanel>
  );
}

export interface EfficiencyPanelProps {
  stats: EfficiencyStats;
}

export function EfficiencyPanel({stats}: EfficiencyPanelProps) {
  const t = useNativeTranslationFallback();
  const activityGlyph = getSemanticIconDefinition('activity').glyph;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={[styles.titleIcon, {color: colors.success}]} weight="bold">
          {activityGlyph}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('charging.efficiency.title', 'Charging Efficiency')}
        </AppText>
        <AppText style={styles.titleHint} tone="muted">
          {t('charging.efficiency.hint', 'Wall-to-battery energy conversion')} (
          {stats.count}{' '}
          {t('charging.efficiency.sessionsWithData', 'sessions with data')})
        </AppText>
      </View>

      <StatGrid>
        <MetricTile
          label={t('charging.efficiency.average', 'Average Efficiency')}
          value={fmtPercent(stats.avgEfficiency)}
          valueColor={VALUE_CYAN}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {width: `${Math.min(stats.avgEfficiency, 100)}%`},
              ]}
            />
          </View>
        </MetricTile>

        <MetricTile
          label={t('charging.efficiency.best', 'Best Session')}
          value={fmtPercent(stats.best.efficiency)}
          valueColor={VALUE_EMERALD}>
          <AppText style={styles.tileSubLabel} tone="muted">
            {formatDateTime(stats.best.date)}
          </AppText>
        </MetricTile>

        <MetricTile
          label={t('charging.efficiency.worst', 'Worst Session')}
          value={fmtPercent(stats.worst.efficiency)}
          valueColor={VALUE_ROSE}>
          <AppText style={styles.tileSubLabel} tone="muted">
            {formatDateTime(stats.worst.date)}
          </AppText>
        </MetricTile>

        <MetricTile
          label={t('charging.efficiency.wallLoss', 'Wall-to-Battery Loss')}
          value={fmtWithUnit(stats.wallLoss, 'kWh')}
          valueColor={VALUE_AMBER}>
          <AppText style={styles.tileSubLabel} tone="muted">
            {fmtNumber(stats.totalUsed)} kWh → {fmtNumber(stats.totalAdded)} kWh
          </AppText>
        </MetricTile>
      </StatGrid>
    </GlassPanel>
  );
}

EfficiencyPanel.displayName = 'EfficiencyPanel';

const styles = StyleSheet.create({
  // GlassPanel p-5.
  panel: {
    padding: 20,
  },
  // section-title flex items-center gap-2 mb-4.
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // The text-neon-green Activity glyph (h-4 w-4).
  titleIcon: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // .section-title: text-lg font-semibold tracking-tight, var(--text-primary).
  title: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  // text-xs font-normal ml-2 var(--text-muted).
  titleHint: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
  // grid ... gap-4, via the negative-margin gutter trick.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -HALF_GAP,
  },
  gridCell: {
    padding: HALF_GAP,
  },
  // Nested GlassPanel p-5 text-center.
  tile: {
    width: '100%',
    padding: 20,
    alignItems: 'center',
  },
  // text-2xl font-bold.
  tileValue: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  // text-[10px] var(--text-muted) mt-1.
  tileLabel: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  // text-[9px] var(--text-muted).
  tileSubLabel: {
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'center',
  },
  // mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden, full width.
  progressTrack: {
    width: '100%',
    height: 6,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    overflow: 'hidden',
  },
  // h-full rounded-full bg-neon-cyan.
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: NEON_CYAN,
  },
});
