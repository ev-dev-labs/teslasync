import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, Zap, DollarSign, Gauge } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { Sparkline } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetStatGrid, type StatGridItem } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

const MI_TO_KM = 1.60934;

const SPARKLINE_COLORS = ['#00f0ff', '#34d399', '#fbbf24', '#a78bfa'];

/**
 * Defensively coerce an unknown payload field into a finite-number array.
 * The trend fields below are not part of the typed `AnalyticsSummary`
 * contract yet, so a malformed value (missing, a scalar, or NaN-poisoned)
 * must never reach `<Sparkline>` where `.filter` would throw on a non-array.
 */
function toNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : [];
}

export default function AnalyticsSummaryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const { formatCurrency } = useFormatting();

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
  const displayDist = toDistanceDisplay(distKm * 1000);

  const effWhKm = data?.avgEfficiencyWhKm ?? 0;
  const displayEff = distanceUnit === 'mi' ? effWhKm * MI_TO_KM : effWhKm;
  const effUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyKwh = data?.totalEnergyKwh ?? 0;
  const totalCost = data?.totalCost ?? 0;
  const costPerDist = displayDist > 0 ? totalCost / displayDist : 0;

  const hasData = distKm > 0 || energyKwh > 0;

  // Trend arrays — API may provide these in the future. Coerce defensively so
  // a non-array/NaN-poisoned payload can never crash the sparkline row.
  const sparklines = useMemo(() => {
    const src = data as Record<string, unknown> | undefined;
    return [
      toNumberArray(src?.distanceTrend),
      toNumberArray(src?.efficiencyTrend),
      toNumberArray(src?.energyTrend),
      toNumberArray(src?.costTrend),
    ];
  }, [data]);
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
      value: costPerDist > 0 ? formatCurrency(costPerDist, 3) : '—',
      icon: <DollarSign className="h-3.5 w-3.5 text-purple-400" />,
    },
  ], [displayDist, displayEff, effUnit, energyKwh, costPerDist, distanceUnit, formatCurrency, t]);

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
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
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
                  <Sparkline
                    data={trend}
                    color={SPARKLINE_COLORS[i]}
                    ariaLabel={t('widget.analyticsSummary.trendAria', '{{metric}} trend', {
                      metric: stats[i]?.label ?? '',
                    })}
                  />
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
