import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState, QueryError } from '@/components/feedback';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';

interface GForcePanelProps {
  vehicleId: number | null | undefined;
}

/**
 * Acceleration G-forces (LateralAcceleration, LongitudinalAcceleration).
 *
 * These were previously stored in the `signal_observations` cold table
 * and read via the deprecated `useSignalObservations` hook. That table
 * and the `/signals/observations` route are gone, so
 * the old hook 404'd silently and this panel rendered a permanent
 * "No G-force telemetry received yet" empty state.
 *
 * Today both signals flow through per-field MQTT to the L1 live cache
 * (mirrored to L2 / Redis with a `signal_log` fallback). We read the
 * latest projected snapshot via `useDriveDynamicsLatest` and render
 * the original 3-up panel (lateral / longitudinal / combined magnitude).
 *
 * The four render states are kept distinct so a transport failure is
 * never mistaken for "no telemetry": loading → skeletons, error →
 * QueryError with retry, no signals → empty state, otherwise the values.
 */
export default function GForcePanel({ vehicleId }: GForcePanelProps) {
  const { t } = useTranslation();

  const { data, isLoading, isError, error, refetch } = useDriveDynamicsLatest(
    vehicleId ?? 0,
    INTERVALS.REALTIME,
  );

  const { lateral, longitudinal, magnitude, hasAny } = useMemo(() => {
    const rawLat = data?.lateral_acceleration;
    const rawLon = data?.longitudinal_acceleration;
    const lat = isFiniteNumber(rawLat) ? rawLat : null;
    const lon = isFiniteNumber(rawLon) ? rawLon : null;
    return {
      lateral: lat,
      longitudinal: lon,
      // Combined magnitude requires BOTH axes — a missing axis is
      // unknown, not zero, so we surface "—" rather than an understated
      // vector length.
      magnitude: lat != null && lon != null ? Math.sqrt(lat * lat + lon * lon) : null,
      hasAny: lat != null || lon != null,
    };
  }, [data?.lateral_acceleration, data?.longitudinal_acceleration]);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const lateralLabel = t('dynamics.lateral', 'Lateral');
  const longitudinalLabel = t('dynamics.longitudinal', 'Longitudinal');
  const combinedLabel = t('dynamics.combined', 'Combined');

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('dynamics.gForce', 'Acceleration G-Force')}
      </PanelTitle>
      {isLoading ? (
        <Grid minItemWidth="standard" gap={4}>
          <StatCard loading label={lateralLabel} value="" />
          <StatCard loading label={longitudinalLabel} value="" />
          <StatCard loading label={combinedLabel} value="" />
        </Grid>
      ) : isError ? (
        <QueryError error={error} onRetry={handleRetry} />
      ) : hasAny ? (
        <Grid minItemWidth="standard" gap={4}>
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={lateralLabel}
            value={lateral != null ? fmtNumber(lateral, 2) : '—'}
            unit="g"
          />
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={longitudinalLabel}
            value={longitudinal != null ? fmtNumber(longitudinal, 2) : '—'}
            unit="g"
          />
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={combinedLabel}
            value={magnitude != null ? fmtNumber(magnitude, 2) : '—'}
            unit="g"
          />
        </Grid>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={t('dynamics.gForceNoData', 'No G-force telemetry received yet')}
        />
      )}
    </GlassPanel>
  );
}
