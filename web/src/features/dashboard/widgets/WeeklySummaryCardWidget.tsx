import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Route, Zap, DollarSign, Gauge } from 'lucide-react';
import { InlineMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtPercent } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';

/** 1 km = 1000 m exactly — scales the digest's km wire value up to SI metres. */
const METERS_PER_KM = 1000;
/** 1 mile = 1.609344 km exactly — converts a per-km rate (Wh/km) to per-mile (Wh/mi). */
const KM_PER_MILE = 1.609344;

/**
 * Derive a display trend from a current vs previous pair. Exported for
 * unit testing (branch coverage of the flat / up / down / lower-is-better
 * cases). A zero baseline yields an em-dash (no meaningful percentage), and
 * sub-1% moves collapse to "~0%" so noise never renders as a coloured arrow.
 */
export function trendOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean } {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { direction: 'flat', value: '—' };
  }
  if (previous === 0) return { direction: 'flat', value: '—' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 1) return { direction: 'flat', value: `~${fmtPercent(Math.abs(pct))}` };
  const direction = pct > 0 ? 'up' : 'down';
  const positive = lowerIsPositive ? pct < 0 : pct > 0;
  return { direction, value: fmtPercent(Math.abs(pct)), positive };
}

function statTrend(
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsPositive = false,
): Pick<StatGridItem, 'trend' | 'trendValue' | 'trendPositive'> {
  const trend = trendOf(current, previous, lowerIsPositive);
  return { trend: trend.direction, trendValue: trend.value, trendPositive: trend.positive };
}

export default function WeeklySummaryCardWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const formatMetric = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? fmtNumber(value) : '—';
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidateId = vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof candidateId === 'number' && Number.isSafeInteger(candidateId) && candidateId > 0
    ? candidateId : undefined;

  const query = useWeeklyDigest(id != null ? String(id) : '');
  const { data, isLoading, refetch } = query;
  const digestState = useDataState(query);
  const vehiclesState = useDataState(vehiclesQuery);
  const resolvingVehicle = id == null && data === undefined;
  const state = resolvingVehicle ? vehiclesState : digestState;
  const retry = resolvingVehicle ? vehiclesQuery.refetch : refetch;
  const freshnessQuery = resolvingVehicle ? vehiclesQuery : query;
  const shellProps = {
    title: t('widget.weeklySummary.title', 'Weekly summary'),
    loading: isLoading || (resolvingVehicle && vehiclesQuery.isLoading),
    dataState: state,
    updatedAt: freshnessQuery.dataUpdatedAt,
    isFetching: freshnessQuery.isFetching,
    isStale: freshnessQuery.isStale,
    isError: freshnessQuery.isError,
    onRefresh: () => { void retry() },
  };
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const metrics = useMemo(() => {
    if (!data) return null;

    // The digest wire shape carries distance in km and efficiency in Wh/km, but
    // convertDistanceFromSI expects SI metres — scale km → m before converting
    // to the user's display unit.
    const toDistance = (km: number | null | undefined) => km == null || !Number.isFinite(km)
      ? null : convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
    // Wh/km → Wh/mi only when the user reads miles; km is already the base unit.
    const toEfficiency = (whPerKm: number | null | undefined) => whPerKm == null || !Number.isFinite(whPerKm)
      ? null : (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm);

    return {
      distance: toDistance(data.distanceKm),
      prevDistance: toDistance(data.prevDistanceKm),
      energy: data.energyKwh,
      prevEnergy: data.prevEnergyKwh,
      cost: data.cost,
      prevCost: data.prevCost,
      efficiency: toEfficiency(data.efficiency),
      prevEfficiency: toEfficiency(data.prevEfficiency),
      drives: data.drives ?? 0,
      prevDrives: data.prevDrives ?? 0,
    };
  }, [data, distanceUnit]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const cost = metrics?.cost != null && Number.isFinite(metrics.cost) ? formatCurrency(metrics.cost) : '—';
  const stats: StatGridItem[] = metrics ? [
    {
      label: t('widget.weeklySummary.distance', 'Distance'), value: formatMetric(metrics.distance), unit: distanceUnit,
      icon: <Route className="h-3.5 w-3.5" />, ...statTrend(metrics.distance, metrics.prevDistance),
    },
    {
      label: t('widget.weeklySummary.energy', 'Energy'), value: formatMetric(metrics.energy), unit: 'kWh',
      icon: <Zap className="h-3.5 w-3.5" />, ...statTrend(metrics.energy, metrics.prevEnergy),
    },
    ...(isWide || isTall ? [
      {
        label: t('widget.weeklySummary.cost', 'Cost'), value: cost,
        icon: <DollarSign className="h-3.5 w-3.5" />, ...statTrend(metrics.cost, metrics.prevCost, true),
      },
      {
        label: t('widget.weeklySummary.efficiency', 'Efficiency'), value: formatMetric(metrics.efficiency), unit: efficiencyUnit,
        icon: <Gauge className="h-3.5 w-3.5" />, ...statTrend(metrics.efficiency, metrics.prevEfficiency, true),
      },
    ] : []),
  ] : [];

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {metrics ? (
          <WidgetBigNumber value={formatMetric(metrics.distance)} unit={distanceUnit}
            label={t('widget.weeklySummary.thisWeek', 'this week')} align="center" />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<TrendingUp className="h-5 w-5" />}
            message={t('widget.weeklySummary.noData', 'No weekly data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={<TrendingUp className="h-3.5 w-3.5 text-cyan-400" />}
      {...shellProps}
    >
      {metrics ? (
        <div className="space-y-2">
          <WidgetStatGrid stats={stats} cols={isWide ? 4 : 2} />

          {!isWide && !isTall && (
            <div className="flex items-center justify-between text-2xs text-[var(--text-muted)] px-1">
              <InlineMetric
                icon={<DollarSign className="h-3 w-3" />}
                value={cost}
              />
              <InlineMetric
                icon={<Gauge className="h-3 w-3" />}
                value={`${formatMetric(metrics.efficiency)} ${efficiencyUnit}`}
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.weeklySummary.noData', 'No weekly data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
