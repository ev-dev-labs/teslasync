// Native parity port of
// web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx.
//
// The web widget is a dashboard "Charge Cost Tracker" tile. It resolves the
// active vehicle (vehicleId prop, else the first vehicle, else 0), fetches the
// last 30 days of charging sessions
// (request<ChargingSession[]>(`/charging?vehicle_id=${id}&limit=100&start=${thirtyDaysAgo}`)
// via useQuery, keyed ['charging', id, 'cost-tracker-30d', thirtyDaysAgo],
// enabled id > 0, staleTime 60_000), and derives cost metrics through the pure
// computeMetrics() helper (total kWh from convertEnergyFromSI, total cost from
// session.cost ?? kWh*costPerKwh, a ~3.5 mi/kWh distance estimate, cost per
// distance unit, and a "vs gas" savings figure). It then renders one of two
// layouts inside a <WidgetShell>:
//   1. Compact (size.cols ≤ 1 && size.rows ≤ 1): a single big 30-day total-cost
//      value over a "30-day cost" eyebrow, or a DollarSign EmptyState when there
//      is no data.
//   2. Standard: a titled shell ("Charge Cost Tracker" + emerald DollarSign)
//      with a 2-up MetricCard row (Total Energy ⚡ cyan + sessions subtitle, and
//      Total Cost 💲 green + $/kWh subtitle); when size.rows ≥ 2 (isTall) a
//      second 2-up MetricCard row (Cost / {unit} ⛽ amber, and vs Gas Savings 📉
//      green + note), otherwise a compact footer line summarising cost/distance
//      and "Saved {amount} vs gas". A DollarSign EmptyState replaces the body
//      when there is no data. Combined query freshness (loading / fetching /
//      stale / error / dataUpdatedAt) and a manual refresh feed the shell header.
//
// This native port preserves that contract 1:1 — the same id/thirtyDaysAgo
// derivations, the same useQuery key/path/enabled/staleTime, the same
// computeMetrics math (incl. the AVG_MI_PER_KWH = 3.5 estimate and the
// session.cost ?? energy*costPerKwh fallback), the same isCompact/isTall/hasData
// branches, the same i18n keys + English defaults (with {{count}}/{{amount}}
// interpolation), and the same visual intent — using React Native primitives,
// the existing native AppText + design tokens and the already-ported native
// MetricCard.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime → inline useNativeTranslation() returns t(key, fallback?, vars?)
//     = (fallback ?? key) with {{var}} interpolation, preserving every key +
//     English default and the count/amount interpolation.
//   - lucide-react DollarSign / Zap / Fuel / TrendingDown (web L4): DOM SVG icons
//     → emoji/glyph stand-ins (💲 / ⚡ / ⛽ / 📉), tinted via the MetricCard neon
//     palette (cyan/green/amber) and the emerald title intent (colors.success).
//   - @/components/data-display MetricCard (web L5): the already-ported native
//     web-parity MetricCard (same label/value/icon/color/subtitle slots).
//   - @/components/feedback EmptyState (web L6): reproduced as a native-safe
//     <EmptyState> (centered icon glyph + muted message, py-4 spacing).
//   - @/api/hooks/useVehicles useVehicles (web L7): the already-ported web-parity
//     useVehicles hook (same data: Vehicle[] shape with `.id`).
//   - @/hooks/useFormatting useFormatting (web L8): not yet ported → reproduced
//     here as a scoped native useFormatting() reading the same web-parity
//     useSettings() query (base_cost_per_kwh / currency_symbol / decimal_precision
//     / gas_efficiency_mpg / gas_price_per_unit / gas_unit) and exposing the
//     consumed costPerKwh / formatCurrency / costPerDistanceUnit / estimateGasCost
//     with byte-for-byte identical logic (incl. the FUEL.GALLONS_TO_LITERS bridge).
//   - @/hooks/useUnits useUnits (web L9): not yet ported → reproduced as a scoped
//     native useUnits() returning unitPrefs.distance derived from the same
//     useSettings().unit_of_length ('mi' → 'mi', else 'km').
//   - @/api/client request (web L10): the already-ported web-parity request()
//     (auto-prefixes /api/v1, so the '/charging…' path is kept verbatim).
//   - @/lib/numberFormat fmtNumber (web L11): inline native fmtNumber (en-US
//     locale, min=max fraction digits) — the established native numberFormat port.
//   - @/lib/unitConversion convertEnergyFromSI / convertDistanceFromSI (web L12,
//     used inside useFormatting): inlined verbatim (Wh→kWh; meters→km/mi/ft).
//   - ./WidgetShell (web L13): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only `compact` when title-less).
//   - ./types WidgetProps (web L14): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.
//   - The web computeMetrics names its function params `mi` while the ported
//     useFormatting treats them as SI meters; this naming-vs-SI mismatch is a
//     pre-existing web characteristic and is preserved verbatim (not "fixed") so
//     the numeric output is identical to the web widget.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {ChargingSession} from '../../../api/types';
import {MetricCard} from '../../../components/data-display/MetricCard';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L4)                             */
/* ------------------------------------------------------------------ */

const ICON_DOLLAR = '\uD83D\uDCB2'; // 💲 (DollarSign)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_FUEL = '\u26FD'; // ⛽ (Fuel)
const ICON_TRENDING_DOWN = '\uD83D\uDCC9'; // 📉 (TrendingDown)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      let out = fallback ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.split(`{{${name}}}`).join(String(value));
        }
      }
      return out;
    },
    [],
  );
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
/*  native-safe number formatter (web @/lib/numberFormat fmtNumber)    */
/* ------------------------------------------------------------------ */

/** Port of web fmtNumber — locale-aware, min=max fraction digits. */
function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/* ------------------------------------------------------------------ */
/*  inlined SI converters (web @/lib/unitConversion, used by formatting)*/
/* ------------------------------------------------------------------ */

type EnergyUnitPref = 'Wh' | 'kWh';
type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

// web FUEL.GALLONS_TO_LITERS (web @/lib/constants).
const GALLONS_TO_LITERS = 3.78541;

/** Port of web convertEnergyFromSI — SI watt-hours → display unit. */
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

/** Port of web convertDistanceFromSI — SI meters → display unit. */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/** Port of web useUnits' deriveDistance — 'mi' stays 'mi', else 'km'. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/* ------------------------------------------------------------------ */
/*  scoped native useUnits (web @/hooks/useUnits, consumed subset)      */
/* ------------------------------------------------------------------ */

interface NativeUnitPrefs {
  distance: DistanceUnitPref;
}

interface UseUnitsResult {
  unitPrefs: NativeUnitPrefs;
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance}}), [distance]);
}

/* ------------------------------------------------------------------ */
/*  scoped native useFormatting (web @/hooks/useFormatting, consumed)   */
/* ------------------------------------------------------------------ */

interface UseFormattingResult {
  costPerKwh: number;
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
  costPerDistanceUnit: (kwh: number, distanceM: number) => number | null;
  estimateGasCost: (distanceM: number) => number | null;
}

function useFormatting(): UseFormattingResult {
  const {data: settings} = useSettings();
  const {unitPrefs} = useUnits();

  const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d)}`;
    },
    [currencySymbol, userPrecision],
  );

  const costPerDistanceUnit = useCallback(
    (kwh: number, distanceM: number): number | null => {
      if (distanceM <= 0) {
        return null;
      }
      const cost = kwh * costPerKwh;
      const distance = convertDistanceFromSI(distanceM, unitPrefs.distance);
      return distance > 0 ? cost / distance : null;
    },
    [costPerKwh, unitPrefs.distance],
  );

  const estimateGasCost = useCallback(
    (distanceM: number): number | null => {
      const mpg = settings?.gas_efficiency_mpg ?? 0;
      const gasPrice = settings?.gas_price_per_unit ?? 0;
      if (mpg <= 0 || gasPrice <= 0 || distanceM <= 0) {
        return null;
      }
      const distanceMi = convertDistanceFromSI(distanceM, 'mi');
      const gallonsUsed = distanceMi / mpg;
      if ((settings?.gas_unit ?? 'gallon') === 'liter') {
        return gallonsUsed * GALLONS_TO_LITERS * gasPrice;
      }
      return gallonsUsed * gasPrice;
    },
    [settings?.gas_efficiency_mpg, settings?.gas_price_per_unit, settings?.gas_unit],
  );

  return useMemo(
    () => ({
      costPerKwh,
      currencySymbol,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    }),
    [
      costPerKwh,
      currencySymbol,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    ],
  );
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
/*  ported helpers (web L17-59)                                         */
/* ------------------------------------------------------------------ */

interface CostMetrics {
  totalKwh: number;
  totalCost: number;
  costPerDistance: number | null;
  gasSavings: number | null;
  sessionCount: number;
  totalDistanceMi: number;
}

function computeMetrics(
  sessions: ChargingSession[],
  costPerKwh: number,
  costPerDistFn: (kwh: number, mi: number) => number | null,
  estimateGasCostFn: (mi: number) => number | null,
): CostMetrics {
  let totalKwh = 0;
  let totalCost = 0;
  let totalDistanceMi = 0;

  for (const s of sessions) {
    const energy = convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh');
    totalKwh += energy;
    // Prefer session cost if recorded, otherwise estimate from kWh
    totalCost += s.cost != null ? s.cost : energy * costPerKwh;
  }

  // Rough distance estimate: ~3.5 mi/kWh average efficiency
  const AVG_MI_PER_KWH = 3.5;
  totalDistanceMi = totalKwh * AVG_MI_PER_KWH;

  const costPerDistance = costPerDistFn(totalKwh, totalDistanceMi);
  const gasCost = estimateGasCostFn(totalDistanceMi);
  const gasSavings = gasCost != null ? gasCost - totalCost : null;

  return {
    totalKwh,
    totalCost,
    costPerDistance,
    gasSavings,
    sessionCount: sessions.length,
    totalDistanceMi,
  };
}

/* ------------------------------------------------------------------ */
/*  ChargeCostTrackerWidget (web L61-226)                              */
/* ------------------------------------------------------------------ */

export default function ChargeCostTrackerWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {costPerKwh} = useFormatting();
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const {formatCurrency, costPerDistanceUnit, estimateGasCost} = useFormatting();

  // Fetch last 30 days of charging sessions
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const {
    data: sessions,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['charging', id, 'cost-tracker-30d', thirtyDaysAgo],
    queryFn: () =>
      request<ChargingSession[]>(
        `/charging?vehicle_id=${id}&limit=100&start=${thirtyDaysAgo}`,
      ),
    enabled: id > 0,
    staleTime: 60_000,
  });

  const metrics = useMemo(
    () =>
      computeMetrics(
        sessions ?? [],
        costPerKwh,
        costPerDistanceUnit,
        estimateGasCost,
      ),
    [sessions, costPerKwh, costPerDistanceUnit, estimateGasCost],
  );

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;
  const hasData = (sessions ?? []).length > 0;

  // Compact: single big metric (total cost)
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        {hasData ? (
          <View style={styles.compactCenter}>
            <AppText style={styles.compactValue}>
              {formatCurrency(metrics.totalCost, 0)}
            </AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.chargeCost.monthly', '30-day cost')}
            </AppText>
          </View>
        ) : (
          <EmptyState
            icon={<AppText style={styles.emptyGlyph}>{ICON_DOLLAR}</AppText>}
            message={t('widget.chargeCost.noData', 'No charge data')}
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargeCost.title', 'Charge Cost Tracker')}
      icon={<AppText style={styles.titleGlyphEmerald}>{ICON_DOLLAR}</AppText>}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {hasData ? (
        <View style={styles.column}>
          <View style={styles.grid2}>
            <View style={styles.gridCell}>
              <MetricCard
                label={t('widget.chargeCost.totalEnergy', 'Total Energy')}
                value={`${fmtNumber(metrics.totalKwh, 1)} kWh`}
                icon={ICON_ZAP}
                color="cyan"
                subtitle={t('widget.chargeCost.sessions', '{{count}} sessions', {
                  count: metrics.sessionCount,
                })}
              />
            </View>
            <View style={styles.gridCell}>
              <MetricCard
                label={t('widget.chargeCost.totalCost', 'Total Cost')}
                value={formatCurrency(metrics.totalCost)}
                icon={ICON_DOLLAR}
                color="green"
                subtitle={`${formatCurrency(costPerKwh)}/${t('widget.chargeCost.kwh', 'kWh')}`}
              />
            </View>
          </View>

          {isTall && (
            <View style={styles.grid2}>
              <View style={styles.gridCell}>
                <MetricCard
                  label={t('widget.chargeCost.costPerDistance', 'Cost / {{unit}}', {
                    unit: distanceUnit,
                  })}
                  value={
                    metrics.costPerDistance != null
                      ? formatCurrency(metrics.costPerDistance, 3)
                      : '\u2014'
                  }
                  icon={ICON_FUEL}
                  color="amber"
                />
              </View>
              <View style={styles.gridCell}>
                <MetricCard
                  label={t('widget.chargeCost.gasSavings', 'vs Gas Savings')}
                  value={
                    metrics.gasSavings != null
                      ? formatCurrency(metrics.gasSavings)
                      : '\u2014'
                  }
                  icon={ICON_TRENDING_DOWN}
                  color="green"
                  subtitle={
                    metrics.gasSavings != null
                      ? t('widget.chargeCost.savingsNote', '30-day estimate')
                      : t(
                          'widget.chargeCost.configureGas',
                          'Set gas price in settings',
                        )
                  }
                />
              </View>
            </View>
          )}

          {!isTall && (
            <View style={styles.footerRow}>
              <AppText style={styles.footerText}>
                {metrics.costPerDistance != null
                  ? `${formatCurrency(metrics.costPerDistance, 3)}/${distanceUnit}`
                  : '\u2014'}
              </AppText>
              <AppText style={styles.footerText}>
                {metrics.gasSavings != null
                  ? t('widget.chargeCost.saved', 'Saved {{amount}} vs gas', {
                      amount: formatCurrency(metrics.gasSavings),
                    })
                  : ''}
              </AppText>
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_DOLLAR}</AppText>}
          message={t('widget.chargeCost.noData', 'No charge data')}
        />
      )}
    </WidgetShell>
  );
}

ChargeCostTrackerWidget.displayName = 'ChargeCostTrackerWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  column: {
    rowGap: spacing.sm,
  },
  compactCenter: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    rowGap: 2,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
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
  footerRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
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
  grid2: {
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
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
  titleGlyphEmerald: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
});
