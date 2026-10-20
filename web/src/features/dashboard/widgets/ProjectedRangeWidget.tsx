import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { MetricBar, type StatMetric } from '@/components/data-display';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { gaugeTone } from '@/lib/tokens';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useProjectedRange } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function healthBadge(score: number, t: (k: string, d: string) => string) {
  if (score >= 90) return { text: t('widget.projectedRange.excellent', 'Excellent'), variant: 'success' as const };
  if (score >= 70) return { text: t('widget.projectedRange.good', 'Good'), variant: 'success' as const };
  if (score >= 50) return { text: t('widget.projectedRange.fair', 'Fair'), variant: 'warning' as const };
  return { text: t('widget.projectedRange.poor', 'Poor'), variant: 'error' as const };
}

export default function ProjectedRangeWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const query = useProjectedRange(idStr);
  const {
    data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch, } = query;
  const trust = useDataState(query, { provenance: 'inferred' });

  const { unitPrefs } = useUnits();
  // This endpoint still emits kilometres; lift to metres before SI display conversion.
  const toDistanceDisplay = useCallback(
    (value: number | null | undefined) => {
      const kilometers = knownNumber(value);
      return kilometers != null ? convertDistanceFromSI(kilometers * 1000, unitPrefs.distance) : null;
    },
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const projectedRange = useMemo(
    () => toDistanceDisplay(data?.current_range_km),
    [data?.current_range_km, toDistanceDisplay],
  );

  const epaRange = useMemo(
    () => toDistanceDisplay(data?.new_range_km),
    [data?.new_range_km, toDistanceDisplay],
  );

  const healthScore = knownNumber(data?.health_score);
  const badge = healthScore != null ? healthBadge(healthScore, t) : undefined;

  // Comparison bar: projected / EPA ratio (clamped 0-100%)
  const rangePct = projectedRange != null && epaRange != null && epaRange > 0
    ? Math.max(0, Math.min(100, (projectedRange / epaRange) * 100))
    : null;

  // Factors list for wide view — derived from available data fields
  const factors = useMemo<StatMetric[]>(() => {
    return [
      {
        label: t('widget.projectedRange.degradation', 'Battery degradation'),
        metricId: 'percent', occurrenceId: 'projected-range-degradation', rawValue: data?.degradation_pct,
        display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
      },
      {
        label: t('widget.projectedRange.avgDaily', 'Avg daily usage'),
        metricId: 'rate', occurrenceId: 'projected-range-daily-distance',
        rawValue: data?.avg_daily_km == null ? data?.avg_daily_km : data.avg_daily_km * 1000,
        description: t('widget.projectedRange.dailySource', 'Returned daily distance rate normalized from kilometers/day to meters/day, not a vehicle speed.'),
        display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
      },
      {
        label: t('widget.projectedRange.capacity', 'Current capacity'),
        metricId: 'percent', occurrenceId: 'projected-range-capacity', rawValue: data?.current_capacity_pct,
        display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
      },
      {
        label: t('widget.projectedRange.cycles', 'Battery cycles'),
        metricId: 'number', occurrenceId: 'projected-range-cycles', rawValue: data?.total_cycles,
        description: t('widget.projectedRange.cyclesSource', 'Returned equivalent battery cycles; not assumed to be an integer event population.'),
        display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      },
    ];
  }, [data, distanceUnit, t, fmtNumber, fmtInt]);

  return (
    <WidgetShell
      title={t('widget.projectedRange.title', 'Projected range')}
      icon={isCompact ? undefined : <Navigation className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <WidgetBigNumber
          value={projectedRange != null ? fmtNumber(projectedRange) : null}
          unit={distanceUnit}
          label={t('widget.projectedRange.projected', 'Projected')}
          badge={badge && {
            ...badge,
            text: isCompact ? badge.text : `${badge.text} · ${fmtNumber(healthScore)}%`,
          }}
          animated={false}
        />
        {!isCompact && (
          <ComparisonBar rangePct={rangePct} epaRange={epaRange} distanceUnit={distanceUnit} t={t} />
        )}
        {isWide && (
          <section className="flex min-w-0 flex-col gap-2">
            <h4 className={dashboardTokens.metricLabel}>{t('widget.projectedRange.factors', 'Range factors')}</h4>
            <DashboardSourceBrief metrics={factors} state={trust}
              eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
              title={t('widget.projectedRange.summaryTitle', 'Returned range-model inputs')}
              description={t('widget.projectedRange.summaryDescription', 'Degradation, daily distance, capacity and equivalent cycles remain distinct from the projected-range hero and retained EPA comparison.')}
              scope={t('widget.projectedRange.summaryScope', 'Vehicle {{id}} · inferred range analysis; exact observation bounds and recording completeness are not supplied.', { id: id ?? '—' })}
              testId="dashboard-projected-range-factors-brief" />
          </section>
        )}
        {!data && (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Navigation className="h-6 w-6" />}
            message={t('widget.projectedRange.noData', 'No projected range data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}

function ComparisonBar({
  rangePct,
  epaRange,
  distanceUnit,
  t,
}: {
  rangePct: number | null;
  epaRange: number | null;
  distanceUnit: string;
  t: (k: string, d: string) => string;
}) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="flex-shrink-0">
      <div className={`${dashboardTokens.metricLabel} mb-1 flex flex-wrap items-center justify-between gap-2`}>
        <span>
          {t('widget.projectedRange.epa', 'EPA')}: {epaRange != null ? `${fmtNumber(epaRange)} ${distanceUnit}` : '—'}
        </span>
      </div>
      <MetricBar
        value={rangePct}
        max={100}
        color={rangePct == null ? gaugeTone.neutral : rangePct >= 80 ? gaugeTone.success : rangePct >= 60 ? gaugeTone.warning : gaugeTone.danger}
        ariaLabel={t('widget.projectedRange.rangeComparison', 'Projected range vs EPA rated')}
        showHeader={false}
        fill="solid"
      />
      {rangePct != null && (
        <p className={`${dashboardTokens.metricLabel} mt-1`}>
          {fmtNumber(rangePct)}% {t('widget.projectedRange.ofEpa', 'of EPA rated')}
        </p>
      )}
    </div>
  );
}
