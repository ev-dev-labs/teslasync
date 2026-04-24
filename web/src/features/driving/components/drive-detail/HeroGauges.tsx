import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface HeroGaugesProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function HeroGauges({ drive, stats }: HeroGaugesProps) {
  const { t } = useTranslation();
  const { convertDistance, convertEfficiency, convertSpeed, distanceUnit, speedUnit, efficiencyUnit, isMiles } = useSettings();

  return (
    <FadeIn>
      <GlassPanel className="p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02] to-purple-500/[0.02]" />
        <div className="relative flex flex-wrap items-center gap-6 lg:gap-10 justify-center">
          <RadialGauge
            value={Math.round(convertDistance(drive.distanceMi))}
            max={Math.max(convertDistance(drive.distanceMi) * 1.5, 100)}
            label={t('driveDetail.distance', 'Distance')}
            unit={distanceUnit}
            color="#00f0ff"
            size={110}
          />
          <RadialGauge
            value={Math.round(stats.maxSpd)}
            max={convertSpeed(250)}
            label={t('driveDetail.maxSpeed', 'Max Speed')}
            unit={speedUnit}
            color="#a855f7"
            size={110}
          />
          <RadialGauge
            value={Math.round(drive.durationMin ?? 0)}
            max={Math.max((drive.durationMin ?? 0) * 1.5, 60)}
            label={t('driveDetail.duration', 'Duration')}
            unit="min"
            color="#f59e0b"
            size={110}
          />
          <RadialGauge
            value={Math.round(convertEfficiency(stats.consumptionWhKm))}
            max={Math.max(convertEfficiency(stats.consumptionWhKm) * 1.5, 300)}
            label={t('driveDetail.consumption', 'Consumption')}
            unit={efficiencyUnit}
            color="#ef4444"
            size={110}
          />
          {stats.efficiencyPctPer100 != null && (
            <RadialGauge
              value={Number(fmtNumber(stats.efficiencyPctPer100))}
              max={30}
              label={t('driveDetail.efficiency', 'Efficiency')}
              unit={isMiles ? '%/100mi' : '%/100km'}
              color="#10b981"
              size={110}
            />
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
