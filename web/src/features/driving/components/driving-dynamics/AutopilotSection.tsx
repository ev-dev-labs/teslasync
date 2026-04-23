import { useTranslation } from 'react-i18next';
import { Navigation, Gauge } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicleLiveState } from '@/api/hooks/useVehicles';
import { useSignalObservations } from '@/api/hooks/useTelemetry';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';

import { latestNumeric } from './signalHelpers';

interface AutopilotSectionProps {
  vehicleId: number | null | undefined;
}

/**
 * Cruise / autopilot panel. Current vehicle speed comes from vehicle_live_state
 * (hot — `VehicleSpeed` hot catalog route). Cruise set-speed & follow distance
 * are cold signals from signal_observations (ADR-005).
 */
export default function AutopilotSection({ vehicleId }: AutopilotSectionProps) {
  const { t } = useTranslation();
  const { convertSpeed, speedUnit } = useSettings();

  const { data: liveState } = useVehicleLiveState(vehicleId ?? undefined);
  const { data: cruiseSetObs } = useSignalObservations(
    vehicleId ?? undefined,
    { signal_name: 'CruiseSetSpeed', limit: 1 },
  );
  const { data: followObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseFollowDistance',
    limit: 1,
  });

  const speedKph = liveState?.speed_kph ?? null;
  const cruiseSet = latestNumeric(cruiseSetObs);
  const followDistance = latestNumeric(followObs);

  const hasAny =
    speedKph != null || cruiseSet != null || followDistance != null;

  // vehicle_live_state.speed_kph is km/h; convertSpeed expects mph. Convert
  // kph → mph before running through the settings transformer.
  const currentSpeedDisplay =
    speedKph != null ? convertSpeed(speedKph / 1.609344) : null;
  const cruiseSetDisplay =
    cruiseSet != null ? convertSpeed(cruiseSet / 1.609344) : null;

  return (
    <FadeIn delay={0.17}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.autopilot', 'Autopilot & Cruise')}
        </h2>
        {hasAny ? (
          <Grid cols={{ default: 1, sm: 3 }} gap={4}>
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              label={t('dynamics.currentSpeed', 'Current Speed')}
              value={
                currentSpeedDisplay != null
                  ? fmtNumber(currentSpeedDisplay, 0)
                  : '—'
              }
              unit={speedUnit}
            />
            <StatCard
              icon={<Navigation className="h-5 w-5" />}
              label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}
              value={
                cruiseSetDisplay != null
                  ? fmtNumber(cruiseSetDisplay, 0)
                  : '—'
              }
              unit={speedUnit}
            />
            <StatCard
              icon={<Navigation className="h-5 w-5" />}
              label={t('dynamics.followDistance', 'Follow Distance')}
              value={
                followDistance != null ? fmtNumber(followDistance, 0) : '—'
              }
            />
          </Grid>
        ) : (
          <EmptyState
            message={t(
              'dynamics.autopilotNoData',
              'No cruise / autopilot telemetry received yet',
            )}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
