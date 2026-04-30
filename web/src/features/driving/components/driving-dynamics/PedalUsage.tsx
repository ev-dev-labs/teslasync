import { useTranslation } from 'react-i18next';
import { Footprints } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSignalObservations } from '@/api/hooks/useTelemetry';

import { latestNumeric, latestBool } from '@/lib/signalObservation';

interface PedalUsageProps {
  vehicleId: number | null | undefined;
}

/**
 * Pedal telemetry (PedalPosition, BrakePedalPos, BrakePedal) is routed to
 * signal_observations (cold) per the typed-telemetry refactor (ADR-005).
 * We read the latest observation for each signal and render the original
 * gauge/badge layout.
 */
export default function PedalUsage({ vehicleId }: PedalUsageProps) {
  const { t } = useTranslation();

  const { data: throttleObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'PedalPosition',
    limit: 1,
  });
  const { data: brakePosObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'BrakePedalPos',
    limit: 1,
  });
  const { data: brakeObs } = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'BrakePedal',
    limit: 1,
  });

  const throttle = latestNumeric(throttleObs);
  const brakePos = latestNumeric(brakePosObs);
  const brakeActive = latestBool(brakeObs);

  const hasAny = throttle != null || brakePos != null || brakeActive != null;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.pedalUsage', 'Pedal Usage')}
        </h2>
        {hasAny ? (
          <Grid cols={{ default: 1, sm: 3 }} gap={6}>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={throttle ?? 0}
                max={100}
                label={t('dynamics.throttle', 'Throttle')}
                unit={throttle != null ? '%' : '—'}
                color="#06b6d4"
                size={140}
              />
              <span className="text-xs text-white/50">
                {t('dynamics.throttlePosition', 'Throttle Position')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={brakePos ?? 0}
                max={100}
                label={t('dynamics.brake', 'Brake')}
                unit={brakePos != null ? '%' : '—'}
                color="#ef4444"
                size={140}
              />
              <span className="text-xs text-white/50">
                {t('dynamics.brakePedalPosition', 'Brake Pedal Position')}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center gap-3">
              <Footprints className="h-8 w-8 text-white/20" />
              <Badge
                variant={brakeActive ? 'danger' : 'success'}
                size="lg"
              >
                {brakeActive
                  ? t('dynamics.brakeActive', 'Brake Active')
                  : t('dynamics.brakeInactive', 'Brake Inactive')}
              </Badge>
              <span className="text-xs text-white/50">
                {t('dynamics.brakePedal', 'Brake Pedal Status')}
              </span>
            </div>
          </Grid>
        ) : (
          <EmptyState
            message={t('dynamics.pedalNoData', 'No pedal telemetry received yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
