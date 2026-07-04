import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
import { fmtNumber } from '@/lib/numberFormat';

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
 */
export default function GForcePanel({ vehicleId }: GForcePanelProps) {
  const { t } = useTranslation();

  const { data } = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);

  const lateral = typeof data?.lateral_acceleration === 'number' ? data.lateral_acceleration : null;
  const longitudinal = typeof data?.longitudinal_acceleration === 'number' ? data.longitudinal_acceleration : null;
  const hasAny = lateral != null || longitudinal != null;

  const magnitude =
    lateral != null && longitudinal != null
      ? Math.sqrt(lateral * lateral + longitudinal * longitudinal)
      : null;

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('dynamics.gForce', 'Acceleration G-Force')}
      </PanelTitle>
      {hasAny ? (
        <Grid cols={{ default: 1, sm: 3 }} gap={4}>
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.lateral', 'Lateral')}
            value={lateral != null ? fmtNumber(lateral, 2) : '—'}
            unit="g"
          />
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.longitudinal', 'Longitudinal')}
            value={longitudinal != null ? fmtNumber(longitudinal, 2) : '—'}
            unit="g"
          />
          <StatCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            label={t('dynamics.combined', 'Combined')}
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
