import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, Thermometer, Gauge, Mountain } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { gaugeTone } from '@/lib/tokens';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useProjectedRange } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

function healthBadge(score: number, t: (k: string, d: string) => string) {
  if (score >= 90) return { text: t('widget.projectedRange.excellent', 'Excellent'), variant: 'success' as const };
  if (score >= 70) return { text: t('widget.projectedRange.good', 'Good'), variant: 'success' as const };
  if (score >= 50) return { text: t('widget.projectedRange.fair', 'Fair'), variant: 'warning' as const };
  return { text: t('widget.projectedRange.poor', 'Poor'), variant: 'error' as const };
}

export default function ProjectedRangeWidget({ vehicleId, size }: WidgetProps) {
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

  const avgDaily = useMemo(
    () => toDistanceDisplay(data?.avg_daily_km),
    [data?.avg_daily_km, toDistanceDisplay],
  );

  const healthScore = knownNumber(data?.health_score);
  const badge = healthScore != null ? healthBadge(healthScore, t) : undefined;

  // Comparison bar: projected / EPA ratio (clamped 0-100%)
  const rangePct = projectedRange != null && epaRange != null && epaRange > 0
    ? Math.max(0, Math.min(100, Math.round((projectedRange / epaRange) * 100)))
    : null;

  // Factors list for wide view — derived from available data fields
  const factors = useMemo(() => {
    return [
      {
        icon: <Gauge className="size-4" />,
        label: t('widget.projectedRange.degradation', 'Battery degradation'),
        value: knownNumber(data?.degradation_pct) != null ? `${fmtNumber(data?.degradation_pct, 1)}%` : null,
      },
      {
        icon: <Navigation className="size-4" />,
        label: t('widget.projectedRange.avgDaily', 'Avg daily usage'),
        value: avgDaily != null ? `${fmtNumber(avgDaily, 0)} ${distanceUnit}` : null,
      },
      {
        icon: <Thermometer className="size-4" />,
        label: t('widget.projectedRange.capacity', 'Current capacity'),
        value: knownNumber(data?.current_capacity_pct) != null ? `${fmtNumber(data?.current_capacity_pct, 1)}%` : null,
      },
      {
        icon: <Mountain className="size-4" />,
        label: t('widget.projectedRange.cycles', 'Battery cycles'),
        value: knownNumber(data?.total_cycles) != null ? fmtNumber(data?.total_cycles, 0) : null,
      },
    ];
  }, [data, avgDaily, distanceUnit, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.projectedRange.title', 'Projected range')}
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
          value={projectedRange != null ? Math.round(projectedRange) : null}
          unit={distanceUnit}
          label={t('widget.projectedRange.projected', 'Projected')}
          badge={badge && {
            ...badge,
            text: isCompact ? badge.text : `${badge.text} · ${fmtNumber(healthScore, 0)}%`,
          }}
          animated={false}
        />
        {!isCompact && (
          <ComparisonBar rangePct={rangePct} epaRange={epaRange} distanceUnit={distanceUnit} t={t} />
        )}
        {isWide && (
          <section className="flex min-w-0 flex-col gap-2">
            <h4 className={dashboardTokens.metricLabel}>{t('widget.projectedRange.factors', 'Range factors')}</h4>
            <WidgetStatGrid stats={factors} cols={2} />
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
  return (
    <div className="flex-shrink-0">
      <div className={`${dashboardTokens.metricLabel} mb-1 flex flex-wrap items-center justify-between gap-2`}>
        <span>
          {t('widget.projectedRange.epa', 'EPA')}: {epaRange != null ? `${fmtNumber(epaRange, 0)} ${distanceUnit}` : '—'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rangePct ?? undefined}
        aria-label={t('widget.projectedRange.rangeComparison', 'Projected range vs EPA rated')}
        className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"
      >
        <div
          className="h-full rounded-full transition-all duration-slow motion-reduce:transition-none"
          style={{
            width: `${rangePct ?? 0}%`,
            backgroundColor: rangePct == null ? gaugeTone.neutral : rangePct >= 80 ? gaugeTone.success : rangePct >= 60 ? gaugeTone.warning : gaugeTone.danger,
          }}
        />
      </div>
      {rangePct != null && (
        <p className={`${dashboardTokens.metricLabel} mt-1`}>
          {rangePct}% {t('widget.projectedRange.ofEpa', 'of EPA rated')}
        </p>
      )}
    </div>
  );
}
