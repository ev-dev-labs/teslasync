import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Footprints } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Caption } from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { EmptyState, Spinner, QueryError } from '@/components/feedback';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';

interface PedalUsageProps {
  vehicleId: number | null | undefined;
}

/**
 * Pedal telemetry (PedalPosition, BrakePedalPos, BrakePedal).
 *
 * These signals used to come from the removed `signal_observations` route;
 * stale callers 404'd silently and left this panel in a permanent
 * "No pedal telemetry received yet" empty state.
 *
 * Today all 3 signals flow through per-field MQTT to the L1 live cache
 * (mirrored to L2 / Redis with a `signal_log` fallback). We read the
 * latest projected snapshot via `useDriveDynamicsLatest` and render
 * the original throttle / brake / brake-active 3-up gauge layout.
 */
export default function PedalUsage({ vehicleId }: PedalUsageProps) {
  const { t } = useTranslation();

  const { data, isLoading, isError, error, refetch } = useDriveDynamicsLatest(
    vehicleId ?? 0,
    INTERVALS.REALTIME,
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const throttle = typeof data?.pedal_position === 'number' ? data.pedal_position : null;
  const brakePos = typeof data?.brake_pedal_position === 'number' ? data.brake_pedal_position : null;
  const brakeActive = typeof data?.brake_pedal_active === 'boolean' ? data.brake_pedal_active : null;

  const hasAny = throttle != null || brakePos != null || brakeActive != null;

  // A missing brake signal must read as "unknown" — never a definitive green
  // "Brake Inactive", which would present absent telemetry as a confirmed
  // pedal-released reading.
  const brakeBadge =
    brakeActive == null
      ? { variant: 'neutral' as const, label: t('dynamics.brakeUnknown', 'Brake Unknown') }
      : brakeActive
        ? { variant: 'danger' as const, label: t('dynamics.brakeActive', 'Brake Active') }
        : { variant: 'success' as const, label: t('dynamics.brakeInactive', 'Brake Inactive') };

  let body: ReactNode;
  if (isLoading) {
    // First fetch in flight (never the disabled/no-vehicle case, which stays
    // idle) — show a spinner instead of the misleading "no telemetry" state.
    body = (
      <div className="flex min-h-[8rem] items-center justify-center py-8">
        <Spinner label={t('dynamics.pedalLoading', 'Loading pedal telemetry…')} />
      </div>
    );
  } else if (hasAny) {
    body = (
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-3">
        <div className="flex flex-col items-center gap-2">
          <LinearGauge
            value={throttle ?? 0}
            max={100}
            label={t('dynamics.throttle', 'Throttle')}
            unit={throttle != null ? '%' : '—'}
            color="#06b6d4"
            size={120}
          />
          <Caption>{t('dynamics.throttlePosition', 'Throttle Position')}</Caption>
        </div>
        <div className="flex flex-col items-center gap-2">
          <LinearGauge
            value={brakePos ?? 0}
            max={100}
            label={t('dynamics.brake', 'Brake')}
            unit={brakePos != null ? '%' : '—'}
            color="#ef4444"
            size={120}
          />
          <Caption>{t('dynamics.brakePedalPosition', 'Brake Pedal Position')}</Caption>
        </div>
        <div className="flex flex-col items-center justify-center gap-3">
          <Footprints className="h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />
          <Badge variant={brakeBadge.variant} size="lg">
            {brakeBadge.label}
          </Badge>
          <Caption>{t('dynamics.brakePedal', 'Brake Pedal Status')}</Caption>
        </div>
      </div>
    );
  } else if (isError) {
    // Surface the failure instead of masking it as an empty panel, but only
    // when we have no prior snapshot to keep showing (a failed background
    // poll never blanks good data).
    body = (
      <QueryError
        error={error}
        onRetry={handleRetry}
        resourceName={t('dynamics.pedalResource', 'Pedal telemetry')}
      />
    );
  } else {
    body = (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('dynamics.pedalNoData', 'No pedal telemetry received yet')}
      />
    );
  }

  return (
    <GlassPanel className="h-full p-4 sm:p-5 @container">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Footprints className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dynamics.pedalUsage', 'Pedal Usage')}
      </PanelTitle>
      {body}
    </GlassPanel>
  );
}
