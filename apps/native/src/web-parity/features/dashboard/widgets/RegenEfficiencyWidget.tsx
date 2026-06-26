// Native parity port of web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx.
//
// Dashboard widget that reads a vehicle's regenerative-braking efficiency
// (useRegenEfficiency -> { regenRatio, totalRegenWh, monthlyAvgRegen,
// freeCharges }) and renders a RadialGauge "recovery %" hero plus three
// summary stats (Total Recovered kWh, Monthly Avg kW, Free Charges) inside a
// widget shell. The compact (1-col) size drops the title + stats and shows only
// the gauge; both sizes fall back to an icon+message empty state when there is
// no regen data. The web file pulls in browser-only or web-UI dependencies that
// are absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L20) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.regenEfficiency.*','<English>') call keeps its English default +
//     translation-key intent (the established MonthlyMileage/ChargeHistory port).
//   - lucide-react RotateCcw (web L3, L82, L95, L107) -> the shared native
//     SemanticIcon 'recycle' (its energy-recovery glyph; success/emerald tone
//     matches the web title icon's text-emerald-400 tint). lucide SVG has no
//     native renderer.
//   - `@/components/feedback` EmptyState (web L4, L81, L106) -> an inlined
//     GaugeEmptyState (icon + centered muted message): the shared native
//     EmptyState takes no icon, but the web call passes an icon (RotateCcw) and
//     message, so the icon+message+centered layout is reproduced with RN
//     primitives (the MonthlyMileage port's inline empty-state precedent). The
//     web className py-2 (compact) / py-4 (standard) collapses to a
//     paddingVertical prop.
//   - `@/api/hooks/useDriving` useRegenEfficiency (web L5) -> the ported native
//     useRegenEfficiency (same '/analytics/regen?vehicle_id=' query, same
//     RegenEfficiencyData shape: regenRatio/totalRegenWh/monthlyAvgRegen/
//     freeCharges).
//   - `@/api/hooks/useVehicles` useVehicles (web L6) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/hooks/useUnits` useUnits (web L7, L21, L38, L42) -> an inlined useUnits()
//     bridge over the ported useFormatPrefs(): it reproduces the web
//     formatEnergy (SI Wh -> kWh) and formatPower (SI W -> kW) string formatters
//     (energy pref 'kWh', power pref 'kW', the resolvePrecision override chain,
//     the '—' nullish fallback) using the shared fmtNumberRaw/isFiniteNumber/
//     FALLBACK primitives, and also exposes fmtInt (web's standalone
//     numberFormat.fmtInt, which on web reads the same settings-derived global
//     locale) so all three formatters share one settings-derived locale/precision
//     read. SI stays on the wire; conversion happens only at the render boundary.
//   - `@/lib/numberFormat` fmtInt (web L8, L46) -> folded into the same native
//     useUnits() bridge (locale-aware 0-decimal formatter), see above.
//   - `./WidgetShell` WidgetShell (web L9) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     MonthlyMileage/ChargeHistory/DriveTelemetry widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted. The
//     web standard-size help tooltip (help.regenEfficiency.body) has no native
//     hover surface and is dropped (web only shows a "?" tooltip on hover).
//   - `./WidgetGaugeHero` + type GaugeHeroStat from `./shared` (web L10) ->
//     inlined native WidgetGaugeHero: the centered RadialGauge + optional
//     wrapping stat row, reproduced with RN primitives (compact size 70 /
//     standard 100, same as web).
//   - `@/components/charts` RadialGauge (used by WidgetGaugeHero) -> the ported
//     native parity RadialGauge (same value/max/label/unit/color/size props).
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity RadialGauge / useRegenEfficiency / useVehicles / useFormatPrefs /
// DataFreshness / QueryError.

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
import {useRegenEfficiency} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {
  FALLBACK,
  fmtNumberRaw,
  isFiniteNumber,
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

// ── @/hooks/useUnits replacement (native bridge over useFormatPrefs) ──
// Native has no useUnits hook. The web useUnits.formatEnergy/formatPower
// delegate to @/lib/unitConversion with a fixed 'kWh' / 'kW' display pref; the
// pure logic is reproduced here over the shared settings-derived locale +
// precision so the rendered strings match (SI Wh -> kWh, SI W -> kW, the
// resolvePrecision override chain, the '—' nullish fallback). fmtInt mirrors the
// standalone @/lib/numberFormat fmtInt (locale-aware 0-decimal integer) and is
// folded into the same bridge so all three formatters share one settings read.
interface FormatOptions {
  precision?: number;
}

type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

/** SI -> display divisors (web convertEnergyFromSI / convertPowerFromSI). */
const WH_PER_KWH = 1000;
const W_PER_KW = 1000;
/** Web DEFAULT_PRECISION.energy / .power fallbacks (used when no override). */
const DEFAULT_ENERGY_PRECISION = 2;
const DEFAULT_POWER_PRECISION = 2;

/** Reproduces web unitConversion.resolvePrecision: override -> pref -> fallback. */
function resolveCallPrecision(
  override: number | undefined,
  prefPrecision: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

interface UseUnitsResult {
  formatEnergy: UnitFormatter;
  formatPower: UnitFormatter;
  fmtInt: (value: number | null | undefined) => string;
}

function useUnits(): UseUnitsResult {
  const {locale, precision} = useFormatPrefs();

  const formatEnergy = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return FALLBACK;
      }
      const digits = resolveCallPrecision(
        options?.precision,
        precision,
        DEFAULT_ENERGY_PRECISION,
      );
      return `${fmtNumberRaw(value / WH_PER_KWH, digits, locale)} kWh`;
    },
    [locale, precision],
  );

  const formatPower = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return FALLBACK;
      }
      const digits = resolveCallPrecision(
        options?.precision,
        precision,
        DEFAULT_POWER_PRECISION,
      );
      return `${fmtNumberRaw(value / W_PER_KW, digits, locale)} kW`;
    },
    [locale, precision],
  );

  const fmtInt = useCallback(
    (value: number | null | undefined) => fmtNumberRaw(value, 0, locale),
    [locale],
  );

  return useMemo(
    () => ({formatEnergy, formatPower, fmtInt}),
    [formatEnergy, formatPower, fmtInt],
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
      <AppText
        style={styles.emptyMessage}
        tone="muted"
        variant="caption">
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

// Web regenColor L13-17: >30% green, >15% amber, else red.
function regenColor(pct: number): string {
  if (pct > 30) {
    return '#10b981';
  }
  if (pct > 15) {
    return '#f59e0b';
  }
  return '#ef4444';
}

export default function RegenEfficiencyWidget({size, vehicleId}: WidgetProps) {
  const t = useNativeTranslation();
  const {formatEnergy, formatPower, fmtInt} = useUnits();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useRegenEfficiency(vehicleIdStr);

  const isCompact = size.cols <= 1;

  const regenPct = (data?.regenRatio ?? 0) * 100;
  const color = useMemo(() => regenColor(regenPct), [regenPct]);

  const stats: GaugeHeroStat[] = useMemo(
    () => [
      {
        label: t('widget.regenEfficiency.totalKwh', 'Total Recovered'),
        value: formatEnergy(data?.totalRegenWh, {precision: 1}),
      },
      {
        label: t('widget.regenEfficiency.monthlyAvg', 'Monthly Avg'),
        value: formatPower(data?.monthlyAvgRegen, {precision: 1}),
      },
      {
        label: t('widget.regenEfficiency.freeCharges', 'Free Charges'),
        value: fmtInt(data?.freeCharges ?? 0),
      },
    ],
    [data, t, formatEnergy, formatPower, fmtInt],
  );

  const gaugeConfig = useMemo(
    () => ({
      value: Math.round(regenPct),
      max: 100,
      label: `${Math.round(regenPct)}%`,
      unit: t('widget.regenEfficiency.recovery', 'recovery'),
      color,
    }),
    [regenPct, color, t],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <View style={styles.compactCenter}>
          {data ? (
            <WidgetGaugeHero compact gauge={gaugeConfig} />
          ) : (
            <GaugeEmptyState
              icon={<SemanticIcon decorative name="recycle" size="md" />}
              message={t('widget.regenEfficiency.noData', 'No regen data')}
              paddingVertical={8}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      {...shellProps}
      icon={<SemanticIcon decorative name="recycle" size="sm" />}
      title={t('widget.regenEfficiency.title', 'Regen Braking')}>
      {data ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
      ) : (
        <GaugeEmptyState
          icon={<SemanticIcon decorative name="recycle" size="md" />}
          message={t('widget.regenEfficiency.noData', 'No regen data')}
          paddingVertical={16}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  compactCenter: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
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
