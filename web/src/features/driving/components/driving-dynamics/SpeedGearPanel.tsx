import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { MotorSnapshot } from '@/api/types';
import type { Drive } from '@/types/driving';

function gearColor(gear: string | undefined): string {
  switch (gear) {
    case 'D': return 'text-emerald-400';
    case 'R': return 'text-red-400';
    case 'N': return 'text-yellow-400';
    case 'P': return 'text-gray-400';
    default: return 'text-white/50';
  }
}

function gearBadgeVariant(gear: string | undefined): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (gear) {
    case 'D': return 'success';
    case 'R': return 'danger';
    case 'N': return 'warning';
    default: return 'neutral';
  }
}

interface SpeedGearPanelProps {
  motorLatest: MotorSnapshot | null | undefined;
  filteredDrives: Drive[];
  convertSpeed: (v: number) => number;
  speedUnit: string;
}

export default function SpeedGearPanel({ motorLatest, filteredDrives, convertSpeed, speedUnit }: SpeedGearPanelProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.speedGear', 'Speed & Gear')}
        </h2>
        <Grid cols={{ default: 2, md: 4 }} gap={6}>
          <div className="flex flex-col items-center gap-2">
            <AnimatedNumber
              value={motorLatest?.vehicle_speed != null ? convertSpeed(motorLatest.vehicle_speed) : 0}
              decimals={0}
              className="text-5xl font-bold text-white"
            />
            <span className="text-sm text-white/50">{speedUnit}</span>
          </div>
          <div className="flex flex-col items-center justify-center gap-2">
            <span className={cn('text-5xl font-bold', gearColor(motorLatest?.gear))}>
              {motorLatest?.gear ?? '—'}
            </span>
            <Badge variant={gearBadgeVariant(motorLatest?.gear)} size="sm">
              {t('dynamics.gear', 'Gear')}
            </Badge>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {filteredDrives.length > 0
                ? fmtNumber(convertSpeed(
                    filteredDrives.reduce((s, d) => s + (d.speedAvg ?? 0), 0) / filteredDrives.length,
                  ), 0)
                : '—'}
            </span>
            <span className="text-xs text-white/40">{speedUnit}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{t('dynamics.topDriveSpeed', 'Top Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {filteredDrives.length > 0
                ? fmtNumber(convertSpeed(
                    Math.max(...filteredDrives.map((d) => d.speedMax ?? 0)),
                  ), 0)
                : '—'}
            </span>
            <span className="text-xs text-white/40">{speedUnit}</span>
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
