import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { Sparkline } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';

import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const { formatCurrency } = useFormatting();

  const query = useAnalyticsSummary();
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const distKm = data?.totalDistanceKm ?? 0;
  const displayDist = toDistanceDisplay(distKm * 1000);

  const effUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const totalCost = data?.totalCost ?? 0;
  const costPerM = isFiniteNumber(data?.totalDistanceKm) && distKm > 0 && isFiniteNumber(data?.totalCost)
    ? totalCost / (distKm * 1000) : null;

  const hasData = data != null;

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

  const stats = useMemo((): StatMetric[] => [
    {
      metricId: 'distance',
      label: t('widget.analyticsSummary.totalDistance', 'Total distance'),
      rawValue: data?.totalDistanceKm == null ? null : data.totalDistanceKm * 1000,
      description: t('widget.analyticsSummary.summary.distanceHelp', 'Fleet distance from the analytics source; kilometres normalized to metres.'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
    },
    {
      metricId: 'efficiency',
      label: t('widget.analyticsSummary.avgEfficiency', 'Avg efficiency'),
      rawValue: data?.avgEfficiencyWhKm == null ? null : data.avgEfficiencyWhKm / 1000,
      description: t('widget.analyticsSummary.summary.efficiencyHelp', 'Source consumption in Wh/km normalized to Wh/m; the original distance conversion factor is retained.'),
      display: { formatter: raw => ({ value: fmtNumber(distanceUnit === 'mi' ? raw * 1000 * MI_TO_KM : raw * 1000), unit: effUnit }) },
    },
    {
      metricId: 'energy',
      label: t('widget.analyticsSummary.energyConsumed', 'Energy consumed'),
      rawValue: data?.totalEnergyKwh == null ? null : data.totalEnergyKwh * 1000,
      description: t('widget.analyticsSummary.summary.energyHelp', 'Source energy normalized from kWh to Wh; the existing kWh display is retained.'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) },
    },
    {
      metricId: 'rate',
      label: t('widget.analyticsSummary.costPerDist', 'Cost / {{unit}}', { unit: distanceUnit }),
      rawValue: costPerM,
      description: t('widget.analyticsSummary.summary.costHelp', 'Recorded cost divided by positive measured distance, retained as source currency per metre; missing operands or zero distance cannot define a rate.'),
      display: { formatter: raw => ({ value: formatCurrency(raw * distKm * 1000 / displayDist), unit: '' }) },
    },
  ], [data, displayDist, distKm, effUnit, costPerM, distanceUnit, formatCurrency, t, fmtNumber]);

  // Compact (1×2): large animated distance number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.analyticsSummary.title', 'Analytics summary')}
        dataState={data || isLoading || isError ? dataState : undefined}
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {hasData ? (
          <WidgetBigNumber
            value={isFiniteNumber(data?.totalDistanceKm) ? fmtNumber(displayDist) : null}
            unit={distanceUnit}
            label={t('widget.analyticsSummary.totalDistance', 'Total distance')}
            align="center"
          />
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
      dataState={data || isLoading || isError ? dataState : undefined}
      title={t('widget.analyticsSummary.title', 'Analytics summary')}
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
          <DashboardSourceBrief
            metrics={stats}
            state={dataState}
            eyebrow={t('widget.analyticsSummary.summary.eyebrow', 'Fleet analytics')}
            title={t('widget.analyticsSummary.summary.title', 'Analytics operating summary')}
            description={t('widget.analyticsSummary.summary.description', 'Fleet-wide analytics using the hook’s default source window. Exact bounds and completeness are not supplied; optional trend arrays retain their own source coverage.')}
            scope={t('widget.analyticsSummary.summary.scope', 'Fleet-wide · default analytics window')}
            testId="analytics-summary-operational-brief"
          />
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
