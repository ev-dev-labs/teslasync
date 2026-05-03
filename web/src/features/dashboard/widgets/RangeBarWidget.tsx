import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function RangeBarWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { convertDistance, distanceUnit } = useSettings();
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;

  const rated = state?.rated_range ?? 0;
  const ideal = state?.ideal_range ?? 0;
  const hasData = state != null && (rated > 0 || ideal > 0);
  const maxRange = Math.max(rated, ideal, 1);

  const ratedConverted = convertDistance(rated);
  const idealConverted = convertDistance(ideal);
  const maxConverted = convertDistance(maxRange);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.rangeBar', 'Range')}
      icon={isCompact ? undefined : <Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center">
            <p className="text-2xl font-bold text-cyan-300">
              {fmtNumber(ratedConverted, 0)}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
              {distanceUnit} {t('widget.rated', 'rated')}
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col justify-center space-y-3">
            <MetricBar
              value={ratedConverted}
              max={maxConverted}
              color="#22d3ee"
              label={t('widget.ratedRange', 'Rated Range')}
              sublabel={`${fmtNumber(ratedConverted, 0)} ${distanceUnit}`}
            />
            <MetricBar
              value={idealConverted}
              max={maxConverted}
              color="#a78bfa"
              label={t('widget.idealRange', 'Ideal Range')}
              sublabel={`${fmtNumber(idealConverted, 0)} ${distanceUnit}`}
            />
            {rated > 0 && ideal > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] text-right">
                {t('widget.epaComparison', 'EPA variance')}{' '}
                <span className="text-[var(--text-secondary)] font-mono">
                  {ideal >= rated ? '+' : ''}
                  {fmtNumber(((ideal - rated) / rated) * 100, 1)}%
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
