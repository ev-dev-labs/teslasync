// Native parity port of web/src/features/dashboard/widgets/APIUsageWidget.tsx.
//
// The web widget is the dashboard "API Usage" tile. It reads admin API-call
// stats from `useApiLogStats()` (GET /api/v1/api-logs/stats — preserved verbatim
// by the already-ported native useAdmin hook) and renders one of two layouts
// driven by `size.cols`:
//   - Compact (cols <= 1): a single big "calls in the last 24h" number with an
//     uppercase caption and, when the error rate exceeds 5%, a red secondary
//     "X% errors" line; otherwise a `BarChart2`-iconed empty state.
//   - Standard (2-up) / Wide (4-up, cols >= 3): a titled shell ("API Usage")
//     wrapping a 4-stat grid — Total Calls (24h), Avg Response (ms), Error Rate
//     (%) and Errors — each a `StatCard`; the error-rate card flips to a red
//     down-trend "High" chip above 5%, and both error cards take a red value
//     tint; otherwise the same empty state.
//
// Every state name, the `size.cols <= 1` / `>= 3` thresholds, the
// `data?.x ?? 0` null-safe derivations, the `coreStats` useMemo + its dependency
// array, the `widget.apiUsage.*` i18n keys with their English fallbacks, the
// `text-red-400` danger emphasis, and the trend semantics are preserved. The
// browser-only pieces are mapped to native-safe equivalents (documented in the
// parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the AddWidgetButton /
//     LayoutManager ports), so every key + copy is preserved.
//   - lucide-react icons (`BarChart2`, `Clock`, `AlertTriangle`, `Activity`,
//     `Zap`) have no native icon dependency; per the AddWidgetButton / Spinner /
//     LayoutManager glyph precedent each becomes a decorative Unicode glyph in an
//     `AppText` with `importantForAccessibility="no"` (the StatCard label / shell
//     title carries the accessible meaning). The `h-3.5 w-3.5` (14px) /
//     `h-5 w-5` (20px) sizes map to fontSize; `text-neon-cyan` on the title icon
//     maps to the accent token (a monochrome bar glyph is used so the tint
//     actually applies).
//   - `@/lib/numberFormat` `fmtInt`/`fmtNumber` are inlined as native-safe
//     formatters mirroring the web module (locale-aware `toLocaleString`, the
//     out-of-box precision-2 / en-US defaults — same approach as the Energy
//     format port).
//   - `WidgetShell` (web: a transparent flex container whose card chrome comes
//     from the dashboard grid cell, with `Skeleton` loading + `QueryError` error
//     + a `DataFreshness` header affordance) is not ported, so a native-safe
//     `WidgetShell` is inlined here on a `GlassPanel` (so the tile is styled when
//     rendered standalone): loading -> a centered `Spinner`, error -> centered
//     danger text, otherwise an optional uppercase title row + a compact
//     freshness control (status dot coloured by isError/isStale/isFetching + a
//     refresh Pressable wired to `refetch`) over the children.
//   - `WidgetStatGrid` / `StatGridItem` (web: a container-query CSS grid of
//     `StatCard`s) is inlined as a `flexWrap` row mapping each item to the
//     already-ported native `StatCard`; the container-query column collapse is
//     approximated with `flexBasis` + `flexGrow`. `valueColor` is forwarded to
//     `StatCard.className` exactly as the web grid does (ignored on native — the
//     red error emphasis still surfaces through the red down-trend chip).
//   - `@/components/feedback` `EmptyState` (icon + message, web role="status") is
//     inlined as a small centered View with the glyph icon + muted message.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useApiLogStats} from '../../../api/hooks/useAdmin';
import {StatCard, type StatCardTrend} from '../../../components/data-display/StatCard';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatters (mirror web @/lib/numberFormat) ─────────── */

// The web `fmtNumber` reads a module-level global precision (default 2) + locale
// (default en-US) set by useSettings; the native parity layer has no settings
// store wired in here, so we mirror the web module's out-of-box defaults.
const DEFAULT_GLOBAL_PRECISION = 2;

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

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

// Monochrome ascending bars for lucide `BarChart2` so the accent tint applies.
const ICON_BAR_CHART = '\u2583\u2585\u2587';
const ICON_ZAP = '\u26A1'; // lucide Zap
const ICON_CLOCK = '\u23F1'; // lucide Clock
const ICON_ALERT = '\u26A0'; // lucide AlertTriangle
const ICON_ACTIVITY = '\u223F'; // lucide Activity
const GLYPH_REFRESH = '\u21BB';

function StatGlyph({children}: {children: string}) {
  return (
    <AppText importantForAccessibility="no" style={styles.statIcon}>
      {children}
    </AppText>
  );
}

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = (
    <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
  );

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── inlined WidgetEmptyState (web @/components/feedback EmptyState) ────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetStatGrid (web shared/WidgetStatGrid.tsx) ────────────────── */

const colBasis: Record<2 | 3 | 4, DimensionValue> = {
  2: '46%',
  3: '31%',
  4: '21%',
};

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) {
    return 3;
  }
  if (count % 4 === 0) {
    return 4;
  }
  return 2;
}

function WidgetStatGrid({
  stats,
  cols,
}: {
  stats: StatGridItem[];
  cols?: 2 | 3 | 4;
}) {
  if (stats.length === 0) {
    return <WidgetEmptyState message="No stats available" />;
  }

  const resolvedCols = cols ?? autoCols(stats.length);

  return (
    <View style={styles.grid}>
      {stats.map(stat => {
        const trend: StatCardTrend | undefined =
          stat.trend && stat.trendValue
            ? {
                direction: stat.trend,
                positive: stat.trend === 'up',
                value: stat.trendValue,
              }
            : undefined;

        return (
          <View
            key={stat.label}
            style={[styles.gridItem, {flexBasis: colBasis[resolvedCols]}]}>
            <StatCard
              className={stat.valueColor}
              icon={stat.icon}
              label={stat.label}
              trend={trend}
              unit={stat.unit}
              value={stat.value}
            />
          </View>
        );
      })}
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function APIUsageWidget({size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useApiLogStats();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const totalCalls = data?.last24h ?? 0;
  const avgResponseMs = data?.avgDurationMs ?? 0;
  const errorRate = data?.errorRate ?? 0;
  const errorCount = data?.errorCount ?? 0;

  const coreStats = useMemo<StatGridItem[]>(() => {
    if (!data) {
      return [];
    }
    return [
      {
        label: t('widget.apiUsage.totalCalls', 'Total Calls (24h)'),
        value: fmtInt(totalCalls),
        icon: <StatGlyph>{ICON_ZAP}</StatGlyph>,
      },
      {
        label: t('widget.apiUsage.avgResponse', 'Avg Response'),
        value: fmtNumber(avgResponseMs, 1),
        unit: 'ms',
        icon: <StatGlyph>{ICON_CLOCK}</StatGlyph>,
      },
      {
        label: t('widget.apiUsage.errorRate', 'Error Rate'),
        value: fmtNumber(errorRate, 1),
        unit: '%',
        icon: <StatGlyph>{ICON_ALERT}</StatGlyph>,
        valueColor: errorRate > 5 ? 'text-red-400' : undefined,
        trend: errorRate > 5 ? 'down' : errorRate > 0 ? 'flat' : undefined,
        trendValue:
          errorRate > 5 ? t('widget.apiUsage.highErrors', 'High') : undefined,
      },
      {
        label: t('widget.apiUsage.totalErrors', 'Errors'),
        value: fmtInt(errorCount),
        icon: <StatGlyph>{ICON_ACTIVITY}</StatGlyph>,
        valueColor: errorCount > 0 ? 'text-red-400' : undefined,
      },
    ];
  }, [data, totalCalls, avgResponseMs, errorRate, errorCount, t]);

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={refetch}
        updatedAt={dataUpdatedAt}>
        {data ? (
          <View style={styles.compact}>
            <AppText style={styles.compactValue}>{fmtInt(totalCalls)}</AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.apiUsage.calls24h', 'Calls (24h)')}
            </AppText>
            {errorRate > 5 ? (
              <AppText style={styles.compactError}>
                {`${fmtNumber(errorRate, 1)}% ${t(
                  'widget.apiUsage.errors',
                  'errors',
                )}`}
              </AppText>
            ) : null}
          </View>
        ) : (
          <WidgetEmptyState
            icon={
              <AppText
                importantForAccessibility="no"
                style={styles.emptyIconGlyph}>
                {ICON_BAR_CHART}
              </AppText>
            }
            message={t('widget.apiUsage.noData', 'No API usage data')}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2) and Wide (2×4)
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        <AppText importantForAccessibility="no" style={styles.titleIcon}>
          {ICON_BAR_CHART}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={refetch}
      title={t('widget.apiUsage.title', 'API Usage')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        <View style={styles.statSection}>
          <WidgetStatGrid cols={isWide ? 4 : 2} stats={coreStats} />
        </View>
      ) : (
        <WidgetEmptyState
          icon={
            <AppText
              importantForAccessibility="no"
              style={styles.emptyIconGlyph}>
              {ICON_BAR_CHART}
            </AppText>
          }
          message={t('widget.apiUsage.noData', 'No API usage data')}
        />
      )}
    </WidgetShell>
  );
}

APIUsageWidget.displayName = 'APIUsageWidget';

const styles = StyleSheet.create({
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compact: {
    alignItems: 'center',
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactError: {
    color: colors.danger,
    fontSize: 10,
    marginTop: 2,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  statIcon: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  statSection: {
    gap: spacing.md,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
