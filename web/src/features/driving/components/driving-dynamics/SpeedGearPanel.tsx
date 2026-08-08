import { useTranslation } from 'react-i18next';

import { Gauge } from 'lucide-react';
import { Grid } from '@/components/layout';
import { GlassPanel, Badge, PanelTitle, Caption, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
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
  vehicleId: number | null | undefined;
  filteredDrives: Drive[];
  toSpeedDisplay: (v: number) => number;
  speedUnit: string;
}

/** One label / value / unit stat column. Keeps all three as siblings in a
 *  single parent so callers (and the regression test) can read the value via
 *  the label's parent. */
function SpeedStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Caption>{label}</Caption>
      <Text as="span" size="2xl" weight="semibold" color="primary" className="tabular-nums">
        {value}
      </Text>
      <Caption>{unit}</Caption>
    </div>
  );
}

export default function SpeedGearPanel({ vehicleId, filteredDrives, toSpeedDisplay, speedUnit }: SpeedGearPanelProps) {
  const { t } = useTranslation();

  // Shares the ['motor-latest', vehicleId] cache entry with LiveMotorStatus —
  // TanStack dedupes on the key, so owning the subscription here costs no
  // extra request and keeps the gear readout live even if the sibling panel
  // unmounts.
  const { data: motorLatest } = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);

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
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('dynamics.speedGear', 'Speed & Gear')}
      </PanelTitle>
      <Grid cols={{ default: 2, md: 4 }} gap={6}>
        <div className="flex flex-col items-center justify-center gap-2">
          <Text as="span" weight="bold" className={cn('text-5xl tabular-nums', shiftColor(motorLatest?.shift_state))}>
            {motorLatest?.shift_state ?? '—'}
          </Text>
          <Badge variant={shiftBadgeVariant(motorLatest?.shift_state)} size="sm">
            {t('dynamics.shiftState', 'Shift State')}
          </Badge>
        </div>
        <SpeedStat
          label={t('dynamics.power', 'Motor Power')}
          value={motorLatest?.power_kw != null ? fmtNumber(motorLatest.power_kw) : '—'}
          unit="kW"
        />
        <SpeedStat
          label={t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}
          value={avgDriveSpeedMps != null ? fmtNumber(toSpeedDisplay(avgDriveSpeedMps), 0) : '—'}
          unit={speedUnit}
        />
        <SpeedStat
          label={t('dynamics.topDriveSpeed', 'Top Drive Speed')}
          value={topDriveSpeedMps != null ? fmtNumber(toSpeedDisplay(topDriveSpeedMps), 0) : '—'}
          unit={speedUnit}
        />
      </Grid>
    </GlassPanel>
  );
}
