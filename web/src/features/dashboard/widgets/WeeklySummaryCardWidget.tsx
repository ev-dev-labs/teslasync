import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Route, Zap, DollarSign, Gauge } from 'lucide-react';
import { StatCard, InlineMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

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
  current: number,
  previous: number,
  lowerIsPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean } {
  if (previous === 0) return { direction: 'flat', value: '—' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 1) return { direction: 'flat', value: '~0%' };
  const direction = pct > 0 ? 'up' : 'down';
  const positive = lowerIsPositive ? pct < 0 : pct > 0;
  return { direction, value: fmtPercent(Math.abs(pct), 0), positive };
}

export default function WeeklySummaryCardWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useWeeklyDigest(String(id));
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const metrics = useMemo(() => {
    if (!data) return null;

    // The digest wire shape carries distance in km and efficiency in Wh/km, but
    // convertDistanceFromSI expects SI metres — scale km → m before converting
    // to the user's display unit.
    const toDistance = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
    // Wh/km → Wh/mi only when the user reads miles; km is already the base unit.
    const toEfficiency = (whPerKm: number) => (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm);

    return {
      distance: toDistance(data.distanceKm ?? 0),
      prevDistance: toDistance(data.prevDistanceKm ?? 0),
      energy: data.energyKwh ?? 0,
      prevEnergy: data.prevEnergyKwh ?? 0,
      cost: data.cost ?? 0,
      prevCost: data.prevCost ?? 0,
      efficiency: toEfficiency(data.efficiency ?? 0),
      prevEfficiency: toEfficiency(data.prevEfficiency ?? 0),
      drives: data.drives ?? 0,
      prevDrives: data.prevDrives ?? 0,
    };
  }, [data, distanceUnit]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  if (isCompact) {
    return (
      <WidgetShell loading={isLoading} error={error ? String(error) : null} updatedAt={dataUpdatedAt} isFetching={isFetching} isStale={isStale} isError={isError} onRefresh={() => refetch()}>
        {metrics ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {fmtNumber(metrics.distance, 0)}
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {distanceUnit} {t('widget.weeklySummary.thisWeek', 'this week')}
            </span>
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

  return (
    <WidgetShell
      title={t('widget.weeklySummary.title', 'Weekly Summary')}
      icon={<TrendingUp className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {metrics ? (
        <div className="space-y-2">
          <div className={cn('grid gap-2', isWide ? 'grid-cols-4' : 'grid-cols-2')}>
            <StatCard
              label={t('widget.weeklySummary.distance', 'Distance')}
              value={fmtNumber(metrics.distance, 1)}
              unit={distanceUnit}
              icon={<Route className="h-3.5 w-3.5" />}
              trend={trendOf(metrics.distance, metrics.prevDistance)}
            />
            <StatCard
              label={t('widget.weeklySummary.energy', 'Energy')}
              value={fmtNumber(metrics.energy, 1)}
              unit="kWh"
              icon={<Zap className="h-3.5 w-3.5" />}
              trend={trendOf(metrics.energy, metrics.prevEnergy)}
            />
            {(isWide || isTall) && (
              <>
                <StatCard
                  label={t('widget.weeklySummary.cost', 'Cost')}
                  value={formatCurrency(metrics.cost)}
                  icon={<DollarSign className="h-3.5 w-3.5" />}
                  trend={trendOf(metrics.cost, metrics.prevCost, true)}
                />
                <StatCard
                  label={t('widget.weeklySummary.efficiency', 'Efficiency')}
                  value={fmtNumber(metrics.efficiency, 0)}
                  unit={efficiencyUnit}
                  icon={<Gauge className="h-3.5 w-3.5" />}
                  trend={trendOf(metrics.efficiency, metrics.prevEfficiency, true)}
                />
              </>
            )}
          </div>

          {!isWide && !isTall && (
            <div className="flex items-center justify-between text-2xs text-[var(--text-muted)] px-1">
              <InlineMetric
                icon={<DollarSign className="h-3 w-3" />}
                value={formatCurrency(metrics.cost)}
              />
              <InlineMetric
                icon={<Gauge className="h-3 w-3" />}
                value={`${fmtNumber(metrics.efficiency, 0)} ${efficiencyUnit}`}
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
