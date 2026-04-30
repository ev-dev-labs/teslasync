import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Route, Zap, DollarSign, Gauge } from 'lucide-react';
import { StatCard, InlineMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { UNITS } from '@/lib/constants';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function trendOf(
  current: number,
  previous: number,
  lowerIsPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean } {
  if (previous === 0) return { direction: 'flat', value: '—' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 1) return { direction: 'flat', value: '~0%' };
  const direction = pct > 0 ? 'up' : 'down';
  const positive = lowerIsPositive ? pct < 0 : pct > 0;
  return { direction, value: `${Math.abs(pct).toFixed(0)}%`, positive };
}

export default function WeeklySummaryCardWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useWeeklyDigest(String(id));
  const {
    convertDistance, convertEfficiency,
    distanceUnit, efficiencyUnit, formatCurrency,
  } = useSettings();

  const metrics = useMemo(() => {
    if (!data) return null;

    // WeeklyDigestData stores distance in km; convert to miles for convertDistance
    const distMi = (data.distanceKm ?? 0) * UNITS.KM_TO_MI;
    const prevDistMi = (data.prevDistanceKm ?? 0) * UNITS.KM_TO_MI;

    // Efficiency in Wh/km; convert to Wh/mi for convertEfficiency
    const effWhMi = (data.efficiency ?? 0) * UNITS.MI_TO_KM;
    const prevEffWhMi = (data.prevEfficiency ?? 0) * UNITS.MI_TO_KM;

    return {
      distance: convertDistance(distMi),
      prevDistance: convertDistance(prevDistMi),
      energy: data.energyKwh ?? 0,
      prevEnergy: data.prevEnergyKwh ?? 0,
      cost: data.cost ?? 0,
      prevCost: data.prevCost ?? 0,
      efficiency: convertEfficiency(effWhMi),
      prevEfficiency: convertEfficiency(prevEffWhMi),
      drives: data.drives ?? 0,
      prevDrives: data.prevDrives ?? 0,
    };
  }, [data, convertDistance, convertEfficiency]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  if (isCompact) {
    return (
      <WidgetShell loading={isLoading} error={error ? String(error) : null} updatedAt={dataUpdatedAt} isFetching={isFetching} isStale={isStale} isError={isError} onRefresh={() => refetch()}>
        {metrics ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5">
            <span className="text-2xl font-bold text-white/90">
              {fmtNumber(metrics.distance, 0)}
            </span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">
              {distanceUnit} {t('widget.weeklySummary.thisWeek', 'this week')}
            </span>
          </div>
        ) : (
          <EmptyState
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
            <div className="flex items-center justify-between text-[10px] text-white/40 px-1">
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
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.weeklySummary.noData', 'No weekly data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
