// Native parity port of
// web/src/features/charging/components/charging-list/QuickMetrics.tsx.
//
// The web QuickMetrics renders a single GlassPanel that either shows a
// responsive 6-cell metric grid (grid-cols-2 sm:grid-cols-3 md:grid-cols-6) or,
// when `stats` is null, an EmptyState. The six cells are:
//   1. homeCount (text-emerald-300, lucide Home icon) -> "Home"
//   2. scCount   (text-rose-300,    lucide Bolt icon) -> "Supercharger"
//   3. dcCount   (text-amber-300,   lucide Zap icon)  -> "DC Fast"
//   4. formatDuration(totalDuration)        (text-primary) -> "Total Time"
//   5. Currency totalCost / 12 precision 0  (text-primary) -> "Monthly Avg"
//   6. fmtWithUnit(totalEnergy / count,'kWh')(text-primary) -> "Per Session"
//
// Native-safe substitutions (documented in the parity sidecar):
//   - web `@/components/ui` GlassPanel -> native GlassPanel card shell; the web
//     className "p-3 sm:p-5" -> padding spacing.lg (20 = the sm:p-5 step).
//   - web `@/components/data-display` AnimatedNumber (requestAnimationFrame
//     count-up) -> inlined settled AnimatedNumber that renders the final
//     fmtNumber(value, 0) value (this parity layer has no rAF count-up wired in);
//     the colour/weight of the web wrapping <p> is passed through via `style`.
//   - web `@/components/data-display` Currency -> inlined formatCurrency that
//     renders `${symbol}${fmtNumber(value, precision)}` with symbol '$' (the
//     out-of-box useFormatting default, per the HeroGauges port) and the same
//     '—' fallback for null/non-finite values.
//   - web `@/components/feedback` EmptyState (message-only) -> native EmptyState
//     (which requires title+message); the web message is passed as both title
//     and message, mirroring the VampireDrain/BatteryDegradation parity ports.
//   - web `@/lib/numberFormat` fmtWithUnit -> inlined native fmtNumber
//     (safeNumber guard, en-US locale, global precision 2 default) + fmtWithUnit.
//   - web `formatDuration` (re-export of `@/lib/dateFormat` formatDurationMinutes)
//     -> inlined formatDuration with the same FALLBACK '—', the negative/
//     non-finite guard, formatRoundedInt (en-US 0-fraction-digit) and the
//     `${h}h ${m}m` / `${m}m` shape.
//   - web `lucide-react` Home/Bolt/Zap (h-3 w-3, inline before each label) ->
//     leading emoji glyphs 🏠 / ⚡ / 🔌 (no native icon dependency; matching the
//     RoutePlayback/SavingsSlide emoji precedent). Bolt -> ⚡ (Supercharger bolt)
//     and Zap -> 🔌 (DC Fast connector) stay visually distinct, and the value
//     colours (emerald/rose/amber) also encode the charger category.
//   - web `react-i18next` useTranslation -> useNativeTranslationFallback() shim
//     (each web t(key, fallback) key + English default preserved verbatim).
//   - web `import type { ChargingStats } from './helpers'` -> inlined local
//     ChargingStats interface (the native helpers sibling is a separate target).
//   - the web responsive grid (2/3/6 cols) collapses to a native 2-column wrap
//     (the grid-cols-2 mobile base), each cell centered (text-center).

import React from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';

/* ─── inlined `./helpers` ChargingStats type ───────────────────────────────── */

interface ChargingStats {
  totalEnergy: number;
  totalCost: number;
  totalDuration: number;
  avgPower: number;
  avgCostPerKwh: number;
  homeCount: number;
  scCount: number;
  dcCount: number;
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

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

/* ─── duration (web `formatDuration` = dateFormat formatDurationMinutes) ────── */

const FALLBACK = '\u2014';

// Mirrors web `formatRoundedInt`: en-US locale, 0 fraction digits.
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function formatDuration(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
    return FALLBACK;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── currency (web `@/components/data-display` Currency) ───────────────────── */

const CURRENCY_SYMBOL = '$';

function formatCurrency(value: number | null | undefined, precision = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return FALLBACK;
  }
  return `${CURRENCY_SYMBOL}${fmtNumber(value, precision)}`;
}

/* ─── settled AnimatedNumber (web rAF count-up has no native analog here) ───── */

function AnimatedNumber({
  value,
  decimals = 0,
  style,
}: {
  value: number;
  decimals?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText style={style} weight="bold">
      {fmtNumber(value, decimals)}
    </AppText>
  );
}

AnimatedNumber.displayName = 'AnimatedNumber';

/* ─── metric cell (web grid <div>: value <p> + icon/label <p>) ─────────────── */

function MetricCell({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <View style={styles.cell}>
      {children}
      <AppText style={styles.label} tone="muted">
        {label}
      </AppText>
    </View>
  );
}

MetricCell.displayName = 'MetricCell';

/* ─── QuickMetrics ─────────────────────────────────────────────────────────── */

interface QuickMetricsProps {
  stats: ChargingStats | null;
}

export function QuickMetrics({stats}: QuickMetricsProps) {
  const t = useNativeTranslationFallback();

  return (
    <GlassPanel style={styles.panel}>
      {stats ? (
        <View style={styles.grid}>
          <MetricCell label={`🏠 ${t('charging.metrics.home', 'Home')}`}>
            <AnimatedNumber
              style={[styles.value, styles.homeColor]}
              value={stats.homeCount}
            />
          </MetricCell>
          <MetricCell
            label={`⚡ ${t('charging.metrics.supercharger', 'Supercharger')}`}>
            <AnimatedNumber
              style={[styles.value, styles.scColor]}
              value={stats.scCount}
            />
          </MetricCell>
          <MetricCell label={`🔌 ${t('charging.metrics.dcFast', 'DC Fast')}`}>
            <AnimatedNumber
              style={[styles.value, styles.dcColor]}
              value={stats.dcCount}
            />
          </MetricCell>
          <MetricCell label={t('charging.metrics.totalTime', 'Total Time')}>
            <AppText style={styles.value} weight="bold">
              {formatDuration(stats.totalDuration)}
            </AppText>
          </MetricCell>
          <MetricCell label={t('charging.metrics.monthlyAvg', 'Monthly Avg')}>
            <AppText style={styles.value} weight="bold">
              {formatCurrency(stats.totalCost / 12, 0)}
            </AppText>
          </MetricCell>
          <MetricCell label={t('charging.metrics.perSession', 'Per Session')}>
            <AppText style={styles.value} weight="bold">
              {fmtWithUnit(stats.totalEnergy / stats.count, 'kWh')}
            </AppText>
          </MetricCell>
        </View>
      ) : (
        <EmptyState
          message={t('charging.noMetrics', 'No charging metrics available yet')}
          title={t('charging.noMetrics', 'No charging metrics available yet')}
        />
      )}
    </GlassPanel>
  );
}

QuickMetrics.displayName = 'QuickMetrics';

// Web Tailwind text colours preserved as literals (emerald/rose/amber-300).
const EMERALD_300 = '#6ee7b7';
const ROSE_300 = '#fda4af';
const AMBER_300 = '#fcd34d';

const styles = StyleSheet.create({
  cell: {
    alignItems: 'center',
    gap: spacing.xs,
    width: '48%',
  },
  dcColor: {
    color: AMBER_300,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.lg,
  },
  homeColor: {
    color: EMERALD_300,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  panel: {
    padding: spacing.lg,
  },
  scColor: {
    color: ROSE_300,
  },
  value: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
});
