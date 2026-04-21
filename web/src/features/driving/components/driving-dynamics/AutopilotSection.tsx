import { useTranslation } from 'react-i18next';
import { Gauge, Navigation } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorSnapshot } from '@/api/types';

interface AutopilotSectionProps {
  motorLatest: MotorSnapshot | null | undefined;
  convertSpeed: (v: number) => number;
  speedUnit: string;
}

export default function AutopilotSection({
  motorLatest,
  convertSpeed,
  speedUnit,
}: AutopilotSectionProps) {
  const { t } = useTranslation();

  const cruiseSetSpeed = motorLatest?.cruise_set_speed;
  const vehicleSpeed = motorLatest?.vehicle_speed;
  const hasCruise = cruiseSetSpeed != null && cruiseSetSpeed > 0;

  const cruiseDisplay =
    cruiseSetSpeed != null ? fmtNumber(convertSpeed(cruiseSetSpeed), 0) : '—';

  const deltaDisplay =
    hasCruise && vehicleSpeed != null
      ? fmtNumber(convertSpeed(vehicleSpeed - cruiseSetSpeed), 0)
      : '—';

  return (
    <FadeIn delay={0.17}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.autopilot', 'Autopilot & Cruise')}
        </h2>
        {motorLatest ? (
          <Grid cols={{ default: 1, sm: 3 }} gap={4}>
            <StatCard
              label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}
              value={cruiseDisplay}
              unit={speedUnit}
              icon={<Gauge className="h-4 w-4" />}
              sublabel={
                hasCruise
                  ? t('dynamics.cruiseActive', 'Cruise control active')
                  : t('dynamics.cruiseInactive', 'Cruise control not set')
              }
            />
            <StatCard
              label={t('dynamics.currentSpeed', 'Current Speed')}
              value={vehicleSpeed != null ? fmtNumber(convertSpeed(vehicleSpeed), 0) : '—'}
              unit={speedUnit}
              icon={<Navigation className="h-4 w-4" />}
            />
            <StatCard
              label={t('dynamics.cruiseDelta', 'Delta vs. Set')}
              value={deltaDisplay}
              unit={speedUnit}
              sublabel={t(
                'dynamics.cruiseDeltaHint',
                'Current speed minus cruise target',
              )}
            />
          </Grid>
        ) : (
          <EmptyState
            message={t('dynamics.autopilotNoData', 'No autopilot telemetry yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
