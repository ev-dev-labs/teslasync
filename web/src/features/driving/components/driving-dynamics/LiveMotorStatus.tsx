import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorSnapshot } from '@/api/types';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  convertTemp: (v: number) => number;
  tempUnit: string;
}

export default function LiveMotorStatus({ motorLatest, convertTemp, tempUnit }: LiveMotorStatusProps) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.liveMotor', 'Live Motor Status')}
        </h2>
        <Grid cols={{ default: 2, md: 4 }} gap={6}>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={motorLatest?.di_torque ?? 0}
              max={500}
              label={t('dynamics.torque', 'Torque')}
              unit="Nm"
              color="#3b82f6"
              size={120}
            />
            <span className="text-xs text-white/50">
              {motorLatest ? `${fmtNumber(motorLatest.di_torque ?? 0)} Nm` : t('dynamics.awaiting', 'Awaiting data')}
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={motorLatest?.di_axle_speed ?? 0}
              max={18000}
              label={t('dynamics.axleSpeed', 'Axle RPM')}
              unit="RPM"
              color="#a855f7"
              size={120}
            />
            <span className="text-xs text-white/50">
              {motorLatest ? `${fmtNumber(motorLatest.di_axle_speed ?? 0, 0)} RPM` : t('dynamics.awaiting', 'Awaiting data')}
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={motorLatest?.di_stator_temp != null ? convertTemp(motorLatest.di_stator_temp) : 0}
              max={200}
              label={t('dynamics.statorTemp', 'Stator')}
              unit={`°${tempUnit}`}
              color="#f59e0b"
              size={120}
            />
            <span className="text-xs text-white/50">
              {motorLatest?.di_stator_temp != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp), 1)}°${tempUnit}`
                : t('dynamics.awaiting', 'Awaiting data')}
            </span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-[120px] w-[120px] items-center justify-center">
              <Badge
                variant={motorLatest?.di_state === 'drive' ? 'success' : 'neutral'}
                size="lg"
              >
                <Cog className="mr-1 h-4 w-4" />
                {motorLatest?.di_state ?? t('dynamics.unknown', 'Unknown')}
              </Badge>
            </div>
            <span className="text-xs text-white/50">
              {t('dynamics.motorState', 'Motor State')}
            </span>
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
