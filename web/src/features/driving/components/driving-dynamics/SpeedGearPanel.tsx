import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { MotorSnapshot } from '@/api/types';
import type { Drive } from '@/types/driving';

function shiftColor(shift: string | null | undefined): string {
  switch (shift) {
    case 'D': return 'text-emerald-400';
    case 'R': return 'text-red-400';
    case 'N': return 'text-yellow-400';
    case 'P': return 'text-gray-400';
    default: return 'text-white/50';
  }
}

function shiftBadgeVariant(shift: string | null | undefined): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (shift) {
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

  const avgDriveSpeed =
    filteredDrives.length > 0
      ? filteredDrives.reduce((s, d) => s + (d.avgSpeedMph ?? 0), 0) / filteredDrives.length
      : null;

  const topDriveSpeed =
    filteredDrives.length > 0
      ? Math.max(...filteredDrives.map((d) => d.maxSpeedMph ?? 0))
      : null;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.speedGear', 'Speed & Gear')}
        </h2>
        <Grid cols={{ default: 2, md: 4 }} gap={6}>
          <div className="flex flex-col items-center justify-center gap-2">
            <span className={cn('text-5xl font-bold', shiftColor(motorLatest?.shift_state))}>
              {motorLatest?.shift_state ?? '—'}
            </span>
            <Badge variant={shiftBadgeVariant(motorLatest?.shift_state)} size="sm">
              {t('dynamics.shiftState', 'Shift State')}
            </Badge>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{t('dynamics.power', 'Motor Power')}</span>
            <span className="text-2xl font-semibold text-white">
              {motorLatest?.power_kw != null ? fmtNumber(motorLatest.power_kw) : '—'}
            </span>
            <span className="text-xs text-white/40">kW</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {avgDriveSpeed != null ? fmtNumber(convertSpeed(avgDriveSpeed), 0) : '—'}
            </span>
            <span className="text-xs text-white/40">{speedUnit}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{t('dynamics.topDriveSpeed', 'Top Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {topDriveSpeed != null ? fmtNumber(convertSpeed(topDriveSpeed), 0) : '—'}
            </span>
            <span className="text-xs text-white/40">{speedUnit}</span>
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
