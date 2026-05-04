import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, Zap, DollarSign, Gauge } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { Sparkline } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { kmToMiles } from '@/lib/unitConversion';
import { WidgetStatGrid, type StatGridItem } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const MI_TO_KM = 1.60934;

const SPARKLINE_COLORS = ['#00f0ff', '#34d399', '#fbbf24', '#a78bfa'];

export default function AnalyticsSummaryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { distanceUnit, currencySymbol } = useSettings();

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAnalyticsSummary();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const distKm = data?.totalDistanceKm ?? 0;
  const displayDist = distanceUnit === 'mi' ? kmToMiles(distKm) : distKm;

  const effWhKm = data?.avgEfficiencyWhKm ?? 0;
  const displayEff = distanceUnit === 'mi' ? effWhKm * MI_TO_KM : effWhKm;
  const effUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyKwh = data?.totalEnergyKwh ?? 0;
  const totalCost = data?.totalCost ?? 0;
  const costPerDist = displayDist > 0 ? totalCost / displayDist : 0;

  const hasData = distKm > 0 || energyKwh > 0;

  // Trend arrays — API may provide these in the future
  const trends = data as Record<string, unknown> | undefined;
  const distTrend = (trends?.distanceTrend as number[] | undefined) ?? [];
  const effTrend = (trends?.efficiencyTrend as number[] | undefined) ?? [];
  const energyTrend = (trends?.energyTrend as number[] | undefined) ?? [];
  const costTrend = (trends?.costTrend as number[] | undefined) ?? [];
  const sparklines = [distTrend, effTrend, energyTrend, costTrend];
  const hasSparklines = sparklines.some((s) => s.length > 0);

  const stats = useMemo((): StatGridItem[] => [
    {
      label: t('widget.analyticsSummary.totalDistance', 'Total Distance'),
      value: fmtNumber(displayDist, 0),
      unit: distanceUnit,
      icon: <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />,
    },
    {
      label: t('widget.analyticsSummary.avgEfficiency', 'Avg Efficiency'),
      value: fmtNumber(displayEff, 0),
      unit: effUnit,
      icon: <Gauge className="h-3.5 w-3.5 text-emerald-400" />,
    },
    {
      label: t('widget.analyticsSummary.energyConsumed', 'Energy Consumed'),
      value: fmtNumber(energyKwh, 1),
      unit: 'kWh',
      icon: <Zap className="h-3.5 w-3.5 text-amber-400" />,
    },
    {
      label: t('widget.analyticsSummary.costPerDist', 'Cost / {{unit}}', { unit: distanceUnit }),
      value: costPerDist > 0 ? `${currencySymbol}${fmtNumber(costPerDist, 3)}` : '—',
      icon: <DollarSign className="h-3.5 w-3.5 text-purple-400" />,
    },
  ], [displayDist, displayEff, effUnit, energyKwh, costPerDist, distanceUnit, currencySymbol, t]);

  // Compact (1×2): large animated distance number
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {hasData ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 min-h-[44px]">
            <AnimatedNumber
              value={Math.round(displayDist)}
              suffix={` ${distanceUnit}`}
              className="text-3xl font-bold text-cyan-400"
            />
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.analyticsSummary.totalDistance', 'Total Distance')}
            </span>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<BarChart3 className="h-5 w-5" />}
            message={t('widget.analyticsSummary.noData', 'No analytics data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2) and Wide (4×2)
  return (
    <WidgetShell
      title={t('widget.analyticsSummary.title', 'Analytics Summary')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        <div className="flex flex-col gap-2">
          <WidgetStatGrid stats={stats} compact={false} cols={isWide ? 4 : 2} />
          {isWide && hasSparklines && (
            <div className="grid grid-cols-4 gap-3">
              {sparklines.map((trend, i) => (
                <div key={i} className="flex items-center justify-center h-[30px]">
                  <Sparkline data={trend} color={SPARKLINE_COLORS[i]} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BarChart3 className="h-5 w-5" />}
          message={t('widget.analyticsSummary.noData', 'No analytics data')}
          className="py-8"
        />
      )}
    </WidgetShell>
  );
}
