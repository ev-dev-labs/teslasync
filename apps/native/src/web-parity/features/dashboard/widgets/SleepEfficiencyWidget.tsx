// Native parity port of web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx.
//
// Dashboard widget that reads a vehicle's sleep efficiency (useSleepEfficiency
// -> SleepEfficiencyData: sleep_efficiency_pct, sentry_off_drain_rate,
// state_distribution[], recent_events[]) and renders a RadialGauge
// "Efficiency %" hero plus three summary stats (Avg Drain/Day, Total Sleep,
// Wake Events) inside a widget shell. The compact (1-col) size drops the title
// + stats (the gauge label is blanked) and shows only the gauge; both sizes
// fall back to an icon+message empty state when there is no sleep data. The web
// file pulls in browser-only or web-UI dependencies that are absent from the
// native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L20) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.sleepEfficiency.*','<English>') call keeps its English default +
//     translation-key intent (the established Regen/MonthlyMileage port).
//   - lucide-react Moon (web L3, L71, L88) -> the shared native SemanticIcon
//     'moon' (its night/sleep glyph; violet tone matches the web title icon's
//     text-indigo-400 tint). lucide SVG has no native renderer.
//   - `@/components/feedback` EmptyState (web L4, L87) -> an inlined
//     GaugeEmptyState (icon + centered muted message): the shared native
//     EmptyState takes no icon, but the web call passes an icon (Moon) and a
//     message, so the icon+message+centered layout is reproduced with RN
//     primitives (the Regen/MonthlyMileage inline empty-state precedent). The
//     web className py-4 collapses to a paddingVertical prop.
//   - `@/api/hooks/useVehicles` useVehicles (web L5) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/api/hooks/useEnergy` useSleepEfficiency (web L6) -> the ported native
//     useSleepEfficiency (same '/analytics/sleep?vehicle_id=&days=30' query,
//     same SleepEfficiencyData shape).
//   - `@/lib/numberFormat` fmtNumber (web L7, L48, L62) -> an inlined
//     useFmtNumber() bridge over the ported useFormatPrefs():
//     fmtNumber(value, decimals?) = fmtNumberRaw(value, decimals ??
//     settingsPrecision, settingsLocale), mirroring web fmtNumber(v, decimals?,
//     locale?) which reads the same settings-derived global locale/precision.
//     Memoized (useCallback) so the stats memo stays reference-stable.
//   - `./shared` WidgetGaugeHero + GaugeHeroConfig/GaugeHeroStat types (web
//     L8-9) -> inlined native WidgetGaugeHero + types: the centered RadialGauge
//     + optional wrapping stat row, reproduced with RN primitives (compact size
//     70 / standard 100, same as web).
//   - `@/components/charts` RadialGauge (used by WidgetGaugeHero) -> the ported
//     native parity RadialGauge (same value/max/label/unit/color/size props).
//   - `./WidgetShell` WidgetShell (web L10) -> inlined native WidgetShell (the
//     skeleton/error/header/overlay-freshness/pulse subset already ported by
//     the Regen/MonthlyMileage/ChargeHistory widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted. The
//     web standard-size help tooltip (help.sleepEfficiency.body) has no native
//     hover surface and is dropped (web only shows a "?" tooltip on hover).
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity RadialGauge / useSleepEfficiency / useVehicles / useFormatPrefs
// / DataFreshness / QueryError.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useSleepEfficiency} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {
  fmtNumberRaw,
  useFormatPrefs,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtNumber replacement (native bridge over useFormatPrefs) ──
// Native has no global-locale numberFormat module. The web fmtNumber(v,
// decimals?, locale?) reads a settings-derived global locale + precision; this
// reproduces it over the shared settings-derived useFormatPrefs() so the
// rendered strings match (locale-aware, fixed decimals; nullish -> 0 via
// fmtNumberRaw's safeNumber). Memoized so stats-memo callers stay stable.
type FmtNumber = (value: unknown, decimals?: number) => string;

function useFmtNumber(): FmtNumber {
  const {locale, precision} = useFormatPrefs();
  return useCallback<FmtNumber>(
    (value, decimals) => fmtNumberRaw(value, decimals ?? precision, locale),
    [locale, precision],
  );
}

// ── ./shared GaugeHeroConfig / GaugeHeroStat + WidgetGaugeHero (ported inline) ──
interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

interface GaugeHeroStat {
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
  // Compact size never grows; the standard size renders the larger gauge.
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHeroRoot}>
      <RadialGauge
        color={gauge.color}
        label={gauge.label}
        max={gauge.max}
        size={size}
        unit={gauge.unit}
        value={gauge.value}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCell}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.statValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.statUnit}
                    tone="secondary"
                    weight="regular">
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

// ── @/components/feedback EmptyState (ported inline as icon + message) ──
interface GaugeEmptyStateProps {
  icon: ReactNode;
  message: string;
  paddingVertical: number;
}

function GaugeEmptyState({icon, message, paddingVertical}: GaugeEmptyStateProps) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches the web EmptyState no-action comment).
  return (
    <View style={[styles.empty, {paddingVertical}]}>
      <View style={styles.emptyIcon}>{icon}</View>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./WidgetShell (ported inline, native-safe subset) ──
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
  // Pulse-on-data-change glow (web WidgetShell L59-80).
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
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
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
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// Web efficiencyColor L13-17: >95% green, >85% amber, else red.
function efficiencyColor(pct: number): string {
  if (pct > 95) {
    return '#10b981'; // green
  }
  if (pct > 85) {
    return '#f59e0b'; // amber
  }
  return '#ef4444'; // red
}

export default function SleepEfficiencyWidget({size, vehicleId}: WidgetProps) {
  const t = useNativeTranslation();
  const fmtNumber = useFmtNumber();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSleepEfficiency(idStr);

  const isCompact = size.cols <= 1;

  const efficiencyPct = data?.sleep_efficiency_pct ?? 0;

  const gauge = useMemo<GaugeHeroConfig>(
    () => ({
      value: efficiencyPct,
      max: 100,
      label: isCompact
        ? ''
        : t('widget.sleepEfficiency.efficiency', 'Efficiency'),
      unit: '%',
      color: data ? efficiencyColor(efficiencyPct) : '#374151',
    }),
    [data, efficiencyPct, isCompact, t],
  );

  // Derive avg drain %/day from the sentry-off drain rate (%/hr).
  const avgDrainPerDay = fmtNumber((data?.sentry_off_drain_rate ?? 0) * 24, 2);

  const totalSleepHours = useMemo(() => {
    const dist = data?.state_distribution ?? [];
    const sleepMinutes = dist
      .filter(s => s.state === 'asleep' || s.state === 'offline')
      .reduce((sum, s) => sum + (s.total_minutes ?? 0), 0);
    return sleepMinutes / 60;
  }, [data]);

  const wakeEventsCount = (data?.recent_events ?? []).length;

  const stats = useMemo<GaugeHeroStat[]>(
    () => [
      {
        label: t('widget.sleepEfficiency.avgDrain', 'Avg Drain/Day'),
        value: avgDrainPerDay,
        unit: '%',
      },
      {
        label: t('widget.sleepEfficiency.totalSleep', 'Total Sleep'),
        value: fmtNumber(totalSleepHours, 0),
        unit: t('widget.sleepEfficiency.hours', 'h'),
      },
      {
        label: t('widget.sleepEfficiency.wakeEvents', 'Wake Events'),
        value: wakeEventsCount,
      },
    ],
    [avgDrainPerDay, totalSleepHours, wakeEventsCount, t, fmtNumber],
  );

  const hasData = data != null;

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <SemanticIcon decorative name="moon" size="sm" />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={
        isCompact
          ? undefined
          : t('widget.sleepEfficiency.title', 'Sleep Efficiency')
      }
      updatedAt={dataUpdatedAt}>
      {hasData ? (
        <WidgetGaugeHero compact={isCompact} gauge={gauge} stats={stats} />
      ) : (
        <GaugeEmptyState
          icon={<SemanticIcon decorative name="moon" size="md" />}
          message={t(
            'widget.sleepEfficiency.noData',
            'No sleep efficiency data',
          )}
          paddingVertical={16}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  gaugeHeroRoot: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  statCell: {
    alignItems: 'center',
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
  },
  statRow: {
    alignItems: 'center',
    columnGap: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 4,
  },
  statUnit: {
    fontSize: 10,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
});
