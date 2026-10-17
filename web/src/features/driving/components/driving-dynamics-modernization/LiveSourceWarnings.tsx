import { useTranslation } from 'react-i18next';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useMotorLatest, useDriveDynamicsLatest, useVehicleState } from '@/api/hooks/useVehicles';
import { useSignalObservations } from '@/api/hooks/useTelemetry';
import { useDataState } from '@/hooks/useDataState';
import { INTERVALS } from '@/lib/constants';

/** Same keys/options as the independent specialist consumers. These notices
 * annotate retained data, never replace or merge snapshots into trip history.
 * No RUM bootstrap, extra API, fallback endpoint, or cache transformation. */
export function LiveSourceWarnings({ vehicleId }: { vehicleId: number | null | undefined }) {
  const { t } = useTranslation();
  const motor = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const dynamics = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const vehicle = useVehicleState(vehicleId ?? 0, { refetchInterval: INTERVALS.REALTIME });
  const cruise = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseSetSpeed', limit: 1, refetchInterval: INTERVALS.FAST,
  });
  const follow = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseFollowDistance', limit: 1, refetchInterval: INTERVALS.FAST,
  });
  const motorState = useDataState(motor);
  const dynamicsState = useDataState(dynamics);
  const vehicleState = useDataState(vehicle);
  const cruiseState = useDataState(cruise);
  const followState = useDataState(follow);
  return (
    <div className="min-w-0 space-y-2">
      <StaleRefreshWarning state={motorState} label={t('dynamics.motorResource', 'Motor telemetry')} />
      <StaleRefreshWarning state={dynamicsState} label={t('dynamics.pedalResource', 'Pedal telemetry')} />
      <StaleRefreshWarning state={vehicleState} label={t('dynamics.currentSpeed', 'Current Speed')} />
      <StaleRefreshWarning state={cruiseState} label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')} />
      <StaleRefreshWarning state={followState} label={t('dynamics.followDistance', 'Follow Distance')} />
      {vehicleState.fatalError ? (
        <section aria-label={t('dynamics.currentSpeed', 'Current Speed')}>
          <Text as="p" variant="bodySm">{t('dynamics.currentSpeed', 'Current Speed')}</Text>
          <QueryError error={vehicleState.fatalError} onRetry={() => void vehicle.refetch()} />
        </section>
      ) : null}
      {cruiseState.fatalError ? (
        <section aria-label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}>
          <Text as="p" variant="bodySm">{t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}</Text>
          <QueryError error={cruiseState.fatalError} onRetry={() => void cruise.refetch()} />
        </section>
      ) : null}
      {followState.fatalError ? (
        <section aria-label={t('dynamics.followDistance', 'Follow Distance')}>
          <Text as="p" variant="bodySm">{t('dynamics.followDistance', 'Follow Distance')}</Text>
          <QueryError error={followState.fatalError} onRetry={() => void follow.refetch()} />
        </section>
      ) : null}
    </div>
  );
}
