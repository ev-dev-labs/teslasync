// Native parity port of
// web/src/features/dashboard/widgets/DriveScoreWidget.tsx.
//
// The web widget is a dashboard "Drive Score" tile. It pulls 7-day fleet
// analytics (useFleetAnalytics(7)), derives a 0-100 score from the fleet's
// average efficiency (lower Wh/mi == better: score = min(100, round(250 /
// efficiency * 100)), or 0 when efficiency <= 0), and renders — inside a
// <WidgetShell> — a <WidgetGaugeHero> radial gauge (value=score, max=100,
// label "Score", colour emerald >75 / amber >50 / red otherwise) with a single
// "Efficiency" stat (the avg efficiency converted to the user's distance unit:
// Wh/km, or Wh/mi via *1.609344) when analytics are present, or a TrendingUp
// EmptyState ("No data yet") when they are not. The gauge shrinks (size 70 vs
// 100, stats hidden) for a 1x1 (isCompact) tile. Query freshness (loading /
// fetching / stale / error / dataUpdatedAt) and a manual refresh feed the shell
// header.
//
// This native port preserves that contract 1:1 — the same useFleetAnalytics(7)
// call + /analytics/fleet path, the same toEfficiencyDisplay / efficiencyUnit /
// efficiency / score / isCompact derivations (incl. the 1.609344 mi factor and
// the 250-baseline score formula), the same gauge + stats memos with identical
// colour thresholds and i18n keys + English defaults, and the same compact /
// empty branches — using React Native primitives, the existing native AppText +
// design tokens, and the already-ported native RadialGauge parity component.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None of this
//     widget's t() calls interpolate.
//   - lucide-react TrendingUp (web L3): DOM SVG icon -> emoji/glyph stand-in
//     (📈), tinted with the muted EmptyState glyph colour.
//   - @/components/feedback EmptyState (web L4): reproduced as a native-safe
//     <EmptyState> (centered icon glyph + muted message, py-4 spacing).
//   - @/api/hooks/useAnalytics useFleetAnalytics (web L5): the already-ported
//     web-parity useFleetAnalytics hook (same signature + /analytics/fleet path).
//   - @/hooks/useUnits useUnits (web L6): not yet ported -> reproduced as a
//     scoped native useUnits() returning unitPrefs.distance derived from the same
//     web-parity useSettings().unit_of_length ('mi' -> 'mi', else 'km').
//   - @/lib/numberFormat fmtNumber (web L7): inline native fmtNumber (locale
//     fixed-fraction-digits) — the established native numberFormat port.
//   - ./WidgetShell (web L8): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only `compact` when title-less).
//   - ./shared WidgetGaugeHero + GaugeHeroConfig + GaugeHeroStat (web L9):
//     reproduced as a native-safe <WidgetGaugeHero> wrapping the already-ported
//     native RadialGauge (web @/components/charts -> web-parity/components/charts/
//     RadialGauge); the compact size (70 vs 100), the hidden-when-compact stat
//     row, and the optional children slot are preserved.
//   - ./types WidgetProps (web L10): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts/RadialGauge';
import {useFleetAnalytics} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 (TrendingUp)

const PULSE_GLOW = '#22c55e';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  native-safe formatter (web @/lib/numberFormat fmtNumber)           */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Port of web fmtNumber — locale number with fixed fraction digits. */
function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? 2;
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

/* ------------------------------------------------------------------ */
/*  scoped native useUnits (web @/hooks/useUnits, consumed subset)     */
/* ------------------------------------------------------------------ */

type DistanceUnitPref = 'mi' | 'km';

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
}

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance}}), [distance]);
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetGaugeHero (web ./shared/WidgetGaugeHero)              */
/* ------------------------------------------------------------------ */

export interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

export interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetGaugeHeroProps {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}

function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: WidgetGaugeHeroProps) {
  // Compact size never grows; standard renders at 100 (web L28).
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero}>
      <RadialGauge
        color={gauge.color}
        label={gauge.label}
        max={gauge.max}
        size={size}
        unit={gauge.unit}
        value={gauge.value}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.gaugeStatsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.gaugeStat}>
              <AppText
                numberOfLines={1}
                style={styles.gaugeStatLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.gaugeStatValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.gaugeStatUnit}
                    tone="secondary"
                    variant="caption">
                    {` ${stat.unit}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? children : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  DriveScoreWidget (web L12-57)                                      */
/* ------------------------------------------------------------------ */

export default function DriveScoreWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {
    data: analytics,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useFleetAnalytics(7);
  const {unitPrefs} = useUnits();
  // web L16 defines toEfficiencyDisplay as a plain per-render arrow; native
  // react-hooks/exhaustive-deps (error-level) requires it be stable since it is
  // listed in the stats useMemo deps — wrapped in useCallback with identical
  // body + behaviour (the only deviation from the verbatim web expression).
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  // Derive a score from efficiency (lower Wh/mi = better score)
  const efficiency = analytics?.avg_efficiency_wh_km ?? 0;
  const score =
    efficiency > 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0;
  const isCompact = size.cols === 1 && size.rows === 1;

  const gauge = useMemo<GaugeHeroConfig>(
    () => ({
      value: score,
      max: 100,
      label: t('widget.score', 'Score'),
      unit: '',
      color: score > 75 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444',
    }),
    [score, t],
  );

  const stats = useMemo<GaugeHeroStat[]>(
    () => [
      {
        label: t('widget.efficiency', 'Efficiency'),
        value: fmtNumber(toEfficiencyDisplay(efficiency), 0),
        unit: efficiencyUnit,
      },
    ],
    [t, efficiency, toEfficiencyDisplay, efficiencyUnit],
  );

  return (
    <WidgetShell
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      updatedAt={dataUpdatedAt}>
      {analytics ? (
        <WidgetGaugeHero compact={isCompact} gauge={gauge} stats={stats} />
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_TRENDING_UP}</AppText>}
          message={t('widget.noScore', 'No data yet')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  gaugeHero: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  gaugeStat: {
    alignItems: 'center',
    minWidth: 0,
  },
  gaugeStatLabel: {
    textAlign: 'center',
  },
  gaugeStatUnit: {
    fontWeight: '400',
  },
  gaugeStatValue: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  gaugeStatsRow: {
    alignItems: 'center',
    columnGap: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.xs,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
});
