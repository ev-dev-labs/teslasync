// Native parity port of web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx.
//
// Dashboard widget that reads a vehicle's this-week-vs-last-week digest
// (useWeeklyDigest -> { drives, distanceKm, energyKwh, efficiency } + their
// prev* peers) and renders a four-row comparison card (Distance / Drives /
// Energy / Efficiency), each row pairing a formatted current value with a
// direction-aware Delta vs the previous week, inside a widget shell. The compact
// (1-col) size drops the title + icon and shows only the first two rows; an
// icon+message empty state surfaces when the digest payload is missing. The web
// file pulls in browser-only or web-UI dependencies that are absent from the
// native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L16) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.weeklyDigest.*','<English>') call keeps its English default +
//     translation-key intent (the established MonthlyMileage/RegenEfficiency port).
//   - lucide-react CalendarDays (web L3, L90, L103) -> the shared native
//     SemanticIcon 'calendar' (its calendar glyph). lucide SVG has no native
//     renderer. The title icon's text-cyan-400 tint collapses to the
//     SemanticIcon calendar intrinsic tone (per-name fixed tone; no override) —
//     the same color-tint -> semantic-icon collapse the MonthlyMileage port uses.
//   - `@/components/feedback` EmptyState (web L4, L102-106) -> an inlined
//     DigestEmptyState (icon + centered muted message): the shared native parity
//     tree has no EmptyState component and the web call passes an icon
//     (CalendarDays) + message + className py-4, so the icon+message+centered
//     layout is reproduced with RN primitives (the RegenEfficiency port's inline
//     empty-state precedent); className py-4 collapses to a fixed paddingVertical.
//   - `@/api/hooks/useAnalytics` useWeeklyDigest (web L5) -> the ported native
//     useWeeklyDigest (same '/vehicles/{id}/weekly-digest' query, same
//     WeeklyDigestData shape, same enabled: !!vehicleId guard + STATIC staleTime).
//   - `@/api/hooks/useVehicles` useVehicles (web L6) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/hooks/useUnits` useUnits (web L7, L23, L24, L26, L27, L28) -> an inlined
//     useUnits() bridge over the ported useFormatPrefs() that exposes the same
//     { unitPrefs: { distance } } shape (so the unitPrefs.distance call sites are
//     preserved, the MonthlyMileage precedent) and additionally folds in the
//     locale-aware fmtNumber/fmtInt so all formatters share one settings read.
//   - `@/lib/numberFormat` fmtNumber + fmtInt (web L8, L57, L65, L72, L80) ->
//     folded into the same native useUnits() bridge over fmtNumberRaw with the
//     settings-derived locale + precision (mirrors web fmtNumber(v, decimals?,
//     locale?) reading the global locale/precision; fmtInt(v) = fmtNumber(v, 0)).
//   - `@/lib/constants` UNITS (web L9, L35, L36, L41, L42) -> inlined KM_TO_MI /
//     MI_TO_KM constants with the exact web values (0.621371 / 1.60934) so the
//     km<->mi pre-scaling that feeds the converters is byte-for-byte preserved.
//   - `./WidgetShell` WidgetShell (web L10) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     MonthlyMileage/RegenEfficiency/ChargeHistory widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetComparisonCard + type ComparisonMetric (web L11) ->
//     inlined native WidgetComparisonCard + MetricRow + the ComparisonMetric
//     type, reproduced with RN primitives. Its web building block, the shared
//     `@/components/data-display` Delta, IS a real shared component in the native
//     tree, so the ported native parity Delta is reused verbatim (same metric/
//     current/previous/display/size props) rather than re-implemented.
//   - `./types` WidgetProps (web L12) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//   - `@/lib/unitConversion` convertDistanceFromSI (web L13, L24) -> imported from
//     the ported native _formatPrimitives (meters -> km|mi), the same native-safe
//     SI display-boundary converter the MonthlyMileage port uses.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity Delta / useWeeklyDigest / useVehicles / useFormatPrefs /
// convertDistanceFromSI / DataFreshness / QueryError.

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
import {useWeeklyDigest} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {Delta} from '../../../components/data-display/Delta';
import {
  convertDistanceFromSI,
  fmtNumberRaw,
  useFormatPrefs,
  type DistanceUnit,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/constants UNITS (ported inline, exact web values) ──
// Web UNITS.KM_TO_MI / UNITS.MI_TO_KM. Both factors are kept verbatim because
// the source mixes them with the precise mile constant below; changing either
// would silently shift the displayed Distance/Efficiency numbers.
const KM_TO_MI = 0.621371;
const MI_TO_KM = 1.60934;

// ── @/hooks/useUnits + @/lib/numberFormat replacement (native bridge) ──
// Native has no useUnits hook; the distance display preference is derived from
// the shared useFormatPrefs bridge (settings -> unit prefs) and exposed under
// the same { unitPrefs: { distance } } shape the web useUnits returns so the
// unitPrefs.distance call sites are preserved. The web file also imports the
// standalone numberFormat fmtNumber/fmtInt (which read the same settings-derived
// global locale/precision); those are folded into this one bridge over
// fmtNumberRaw so every formatter shares a single settings read.
interface UnitPrefs {
  distance: DistanceUnit;
}

interface UseUnitsResult {
  unitPrefs: UnitPrefs;
  fmtNumber: (value: number, decimals?: number) => string;
  fmtInt: (value: number) => string;
}

function useUnits(): UseUnitsResult {
  const {distanceUnit, locale, precision} = useFormatPrefs();

  // Mirrors web numberFormat.fmtNumber(v, decimals?, locale?): decimals falls
  // back to the settings-derived global precision, locale to the global locale.
  const fmtNumber = useCallback(
    (value: number, decimals?: number) =>
      fmtNumberRaw(value, decimals ?? precision, locale),
    [locale, precision],
  );

  // Mirrors web numberFormat.fmtInt(v) = fmtNumber(v, 0).
  const fmtInt = useCallback(
    (value: number) => fmtNumberRaw(value, 0, locale),
    [locale],
  );

  return useMemo(
    () => ({unitPrefs: {distance: distanceUnit}, fmtNumber, fmtInt}),
    [distanceUnit, fmtNumber, fmtInt],
  );
}

// ── ./shared ComparisonMetric + WidgetComparisonCard (ported inline) ──
interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  formattedCurrent: string;
  unit?: string;
  higherIsBetter?: boolean;
}

interface WidgetComparisonCardProps {
  metrics: ComparisonMetric[];
  compact?: boolean;
}

function MetricRow({metric, isLast}: {metric: ComparisonMetric; isLast: boolean}) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const direction = higherIsBetter ? 'higher_better' : 'lower_better';

  return (
    <View style={[styles.metricRow, isLast && styles.metricRowLast]}>
      <View style={styles.metricLabelCol}>
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption">
          {metric.label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue} weight="semibold">
          {metric.formattedCurrent}
          {metric.unit ? (
            <AppText style={styles.metricUnit} tone="muted" weight="regular">
              {` ${metric.unit}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      <Delta
        current={metric.current}
        display="percent"
        metric={{direction}}
        previous={metric.previous}
        size="sm"
      />
    </View>
  );
}

function WidgetComparisonCard({compact, metrics}: WidgetComparisonCardProps) {
  const visible = compact ? metrics.slice(0, 2) : metrics;

  if (visible.length === 0) {
    return (
      <AppText style={styles.noComparison} tone="muted">
        No comparison data
      </AppText>
    );
  }

  return (
    <View style={styles.comparisonRoot}>
      {visible.map((m, idx) => (
        <MetricRow
          isLast={idx === visible.length - 1}
          key={m.label}
          metric={m}
        />
      ))}
    </View>
  );
}

// ── @/components/feedback EmptyState (ported inline as icon + message) ──
function DigestEmptyState({icon, message}: {icon: ReactNode; message: string}) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches the web EmptyState no-action comment).
  return (
    <View style={styles.empty}>
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

export default function WeeklyDigestWidget({size, vehicleId}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useWeeklyDigest(String(id));

  const {unitPrefs, fmtNumber, fmtInt} = useUnits();
  // useCallback keeps the converters stable across renders so the metrics
  // useMemo dependency list satisfies react-hooks/exhaustive-deps (the web file
  // recreated these inline each render; native lint is stricter).
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );

  const isCompact = size.cols <= 1;

  const metrics = useMemo<ComparisonMetric[]>(() => {
    if (!data) return [];

    const distMi = (data.distanceKm ?? 0) * KM_TO_MI;
    const prevDistMi = (data.prevDistanceKm ?? 0) * KM_TO_MI;
    const dist = toDistanceDisplay(distMi);
    const prevDist = toDistanceDisplay(prevDistMi);

    // Efficiency stored as Wh/km → convert to Wh/mi for toEfficiencyDisplay
    const effWhMi = (data.efficiency ?? 0) * MI_TO_KM;
    const prevEffWhMi = (data.prevEfficiency ?? 0) * MI_TO_KM;
    const eff = toEfficiencyDisplay(effWhMi);
    const prevEff = toEfficiencyDisplay(prevEffWhMi);

    const energy = data.energyKwh ?? 0;
    const prevEnergy = data.prevEnergyKwh ?? 0;

    const drives = data.drives ?? 0;
    const prevDrives = data.prevDrives ?? 0;

    return [
      {
        label: t('widget.weeklyDigest.distance', 'Distance'),
        current: dist,
        previous: prevDist,
        formattedCurrent: fmtNumber(dist, 1),
        unit: distanceUnit,
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.drives', 'Drives'),
        current: drives,
        previous: prevDrives,
        formattedCurrent: fmtInt(drives),
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.energy', 'Energy'),
        current: energy,
        previous: prevEnergy,
        formattedCurrent: fmtNumber(energy, 1),
        unit: 'kWh',
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.efficiency', 'Efficiency'),
        current: eff,
        previous: prevEff,
        formattedCurrent: fmtNumber(eff, 0),
        unit: efficiencyUnit,
        higherIsBetter: false,
      },
    ];
  }, [
    data,
    toDistanceDisplay,
    toEfficiencyDisplay,
    distanceUnit,
    efficiencyUnit,
    fmtNumber,
    fmtInt,
    t,
  ]);

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        isCompact ? undefined : (
          <SemanticIcon decorative name="calendar" size="sm" />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.weeklyDigest.title', 'This Week')}
      updatedAt={dataUpdatedAt}>
      {metrics.length > 0 ? (
        <WidgetComparisonCard compact={isCompact} metrics={metrics} />
      ) : (
        <DigestEmptyState
          icon={<SemanticIcon decorative name="calendar" size="md" />}
          message={t('widget.weeklyDigest.noData', 'No weekly data yet')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  comparisonRoot: {
    flexDirection: 'column',
  },
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
    paddingVertical: 16,
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  metricLabel: {
    fontSize: 12,
  },
  metricLabelCol: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  metricRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  metricUnit: {
    fontSize: 12,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  noComparison: {
    fontSize: 14,
    paddingVertical: 8,
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
