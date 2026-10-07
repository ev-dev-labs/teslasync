import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * Format an SI range (metres) for display in the user's distance unit.
 *
 * A genuinely-absent reading (null / undefined / NaN) renders the em-dash
 * placeholder rather than a fabricated "0 km": a coalesced zero is
 * indistinguishable from "no data" and reads as a dead battery. A real,
 * finite zero is preserved and shown as "0 <unit>". Exported for unit testing.
 */
export function formatRange(
  meters: number | null | undefined,
  distanceUnit: DistanceUnitPref,
): string {
  if (!isFiniteNumber(meters)) return '—';
  return `${fmtNumber(convertDistanceFromSI(meters, distanceUnit), 0)} ${distanceUnit}`;
}

export default function RangeEstimateWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  /* SI-floor: state.rated_range / state.ideal_range arrive in METERS. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;

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
      <div className="h-full flex flex-col justify-center">
        {state ? (
          <div className="space-y-3">
            <div>
              <p className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.ratedRange', 'Rated Range')}
              </p>
              <p className="text-xl font-bold text-cyan-300">
                {formatRange(state.rated_range, distanceUnit)}
              </p>
            </div>
            <div>
              <p className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.idealRange', 'Ideal Range')}
              </p>
              <p className="text-lg font-semibold text-[var(--text-primary)]">
                {formatRange(state.ideal_range, distanceUnit)}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Gauge className="h-6 w-6" />}
            message={t('widget.noRange', 'No range data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
