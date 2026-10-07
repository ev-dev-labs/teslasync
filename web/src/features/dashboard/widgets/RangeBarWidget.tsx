import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export default function RangeBarWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // SI-floor: state.rated_range / state.ideal_range arrive in METERS. Everything
  // downstream converts to the user's display unit exactly once, here.
  const range = useMemo(() => {
    const rated = state?.rated_range ?? 0;
    const ideal = state?.ideal_range ?? 0;
    const maxRange = Math.max(rated, ideal, 1);
    // The compact headline prefers the rated figure but falls back to the ideal
    // range when rated is unknown (0), so a vehicle that only reports an ideal
    // range never surfaces a misleading "0".
    const usesRated = rated > 0;
    const primary = usesRated ? rated : ideal;
    return {
      hasData: state != null && (rated > 0 || ideal > 0),
      usesRated,
      ratedConverted: convertDistanceFromSI(rated, distanceUnit),
      idealConverted: convertDistanceFromSI(ideal, distanceUnit),
      maxConverted: convertDistanceFromSI(maxRange, distanceUnit),
      primaryConverted: convertDistanceFromSI(primary, distanceUnit),
      // Percentage variance of ideal vs. rated. Unit-independent (a ratio), so
      // it is computed from the SI values. Null when either side is unknown to
      // avoid a divide-by-zero and a meaningless "±0%" readout.
      variancePct: rated > 0 && ideal > 0 ? ((ideal - rated) / rated) * 100 : null,
    };
  }, [state, distanceUnit]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.rangeBar', 'Range')}
      icon={isCompact ? undefined : <Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
      loading={isLoading || vehiclesLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {range.hasData ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center">
            <p className="text-2xl font-bold text-cyan-300">
              {fmtNumber(range.primaryConverted, 0)}
            </p>
            <p className="text-2xs text-[var(--text-muted)]">
              {distanceUnit}{' '}
              {range.usesRated ? t('widget.rated', 'rated') : t('widget.ideal', 'ideal')}
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col justify-center space-y-3">
            <MetricBar
              value={range.ratedConverted}
              max={range.maxConverted}
              color="#22d3ee"
              label={t('widget.ratedRange', 'Rated Range')}
              sublabel={`${fmtNumber(range.ratedConverted, 0)} ${distanceUnit}`}
            />
            <MetricBar
              value={range.idealConverted}
              max={range.maxConverted}
              color="#a78bfa"
              label={t('widget.idealRange', 'Ideal Range')}
              sublabel={`${fmtNumber(range.idealConverted, 0)} ${distanceUnit}`}
            />
            {range.variancePct != null && (
              <p className="text-2xs text-[var(--text-muted)] text-right">
                {t('widget.epaComparison', 'EPA variance')}{' '}
                <span className="text-[var(--text-secondary)] font-mono">
                  {range.variancePct >= 0 ? '+' : ''}
                  {fmtNumber(range.variancePct, 1)}%
                </span>
              </p>
            )}
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-6 w-6" />}
          message={t('widget.noRange', 'No range data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
