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
    case 'P': return 'text-[var(--text-muted)]';
    default: return 'text-[var(--text-secondary)]';
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
  toSpeedDisplay: (v: number) => number;
  speedUnit: string;
}

export default function SpeedGearPanel({ motorLatest, filteredDrives, toSpeedDisplay, speedUnit }: SpeedGearPanelProps) {
  const { t } = useTranslation();

  // Compute drive-level aggregates in SI (m/s) and convert ONCE at render
  // time. The pre-fix code called `toSpeedDisplay` once during the
  // reduce/Math.max AND a second time at the JSX render site, which
  // double-applied the m/s → mph factor (×2.237 squared = ×5.005). For
  // mph users that turned a real ~31 mph top into a displayed "154 mph";
  // for km/h users it was even worse (×3.6 → ×12.96). The bug shipped
  // since this panel was extracted from the legacy DrivingDynamicsPage,
  // because the surrounding code had already moved to "convert at the
  // boundary" semantics but these two reductions kept the legacy "convert
  // eagerly, render verbatim" assumption from the old in-line code.
  const avgDriveSpeedMps =
    filteredDrives.length > 0
      ? filteredDrives.reduce((s, d) => s + (d.avgSpeedMps ?? 0), 0) / filteredDrives.length
      : null;

  const topDriveSpeedMps =
    filteredDrives.length > 0
      ? Math.max(...filteredDrives.map((d) => d.maxSpeedMps ?? 0))
      : null;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
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
            <span className="text-xs text-[var(--text-secondary)]">{t('dynamics.power', 'Motor Power')}</span>
            <span className="text-2xl font-semibold text-white">
              {motorLatest?.power_kw != null ? fmtNumber(motorLatest.power_kw) : '—'}
            </span>
            <span className="text-xs text-[var(--text-muted)]">kW</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">{t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {avgDriveSpeedMps != null ? fmtNumber(toSpeedDisplay(avgDriveSpeedMps), 0) : '—'}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{speedUnit}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">{t('dynamics.topDriveSpeed', 'Top Drive Speed')}</span>
            <span className="text-2xl font-semibold text-white">
              {topDriveSpeedMps != null ? fmtNumber(toSpeedDisplay(topDriveSpeedMps), 0) : '—'}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{speedUnit}</span>
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
