import { useTranslation } from 'react-i18next';
import { Footprints } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { FadeIn } from '@/components/motion';
import type { MotorSnapshot } from '@/api/types';

interface PedalUsageProps {
  motorLatest: MotorSnapshot | null | undefined;
}

export default function PedalUsage({ motorLatest }: PedalUsageProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.pedalUsage', 'Pedal Usage')}
        </h2>
        <Grid cols={{ default: 2 }} gap={6}>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={motorLatest?.pedal_position ?? 0}
              max={100}
              label={t('dynamics.throttle', 'Throttle')}
              unit="%"
              color="#06b6d4"
              size={140}
            />
            <span className="text-xs text-white/50">
              {t('dynamics.throttlePosition', 'Throttle Position')}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center gap-3">
            <Footprints className="h-8 w-8 text-white/20" />
            <Badge
              variant={motorLatest?.brake_pedal ? 'danger' : 'success'}
              size="lg"
            >
              {motorLatest?.brake_pedal
                ? t('dynamics.brakeActive', 'Brake Active')
                : t('dynamics.brakeInactive', 'Brake Inactive')}
            </Badge>
            <span className="text-xs text-white/50">
              {t('dynamics.brakePedal', 'Brake Pedal Status')}
            </span>
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
