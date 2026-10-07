import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup, type StatMetric } from '@/components/data-display/stat-reference';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { INTERVALS } from '@/lib/constants';
import { cn } from '@/lib/cn';
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
}

/** Same arithmetic means/max in SI; display conversion happens only in tiles.
 * Separate periods prevent loaded-trip speeds being labelled current. */
export default function SpeedGearPanel({ vehicleId, filteredDrives }: SpeedGearPanelProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const query = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const state = useDataState(query);
  const motorLatest = state.data;
  const averages = (filteredDrives ?? []).flatMap(drive => drive.avgSpeedMps != null ? [drive.avgSpeedMps] : []);
  const peaks = (filteredDrives ?? []).flatMap(drive => drive.maxSpeedMps != null ? [drive.maxSpeedMps] : []);
  const avgDriveSpeedMps = averages.length > 0
    ? averages.reduce((sum, speed) => sum + speed, 0) / averages.length : null;
  const topDriveSpeedMps = peaks.length > 0 ? Math.max(...peaks) : null;
  const speeds: StatMetric[] = [
    { metricId: 'speed', occurrenceId: 'range-average-drive-speed', rawValue: avgDriveSpeedMps,
      label: t('dynamics.avgDriveSpeed', 'Avg Drive Speed') },
    { metricId: 'speed', occurrenceId: 'range-top-drive-speed', rawValue: topDriveSpeedMps,
      label: t('dynamics.topDriveSpeed', 'Top Drive Speed') },
  ];
  const preferences = {
    units: { ...unitPrefs, precision, locale },
    currency: { kind: 'symbol' as const, value: '' },
  };
  return (
    <LayoutCard title={t('dynamics.speedGear', 'Speed & Gear')}>
      <Text as="p" variant="caption">
        {t('dynamics.review.speedGearScope', 'Gear and motor power: latest vehicle signals. Average and top speed: loaded trips in the date range, not just the selected ride.')}
      </Text>
      <StaleRefreshWarning state={state} label={t('dynamics.speedGear', 'Speed & Gear')} />
      {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void query.refetch()} /> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Text as="span" weight="bold" className={cn('text-5xl tabular-nums', shiftColor(motorLatest?.shift_state))}>
          {motorLatest?.shift_state ?? '—'}
        </Text>
        <Badge variant={shiftBadgeVariant(motorLatest?.shift_state)} size="sm">
          {t('dynamics.shiftState', 'Shift State')}
        </Badge>
      </div>
      <StatGroup
        id="dynamics-current-motor-power"
        metrics={[{
          metricId: 'power', occurrenceId: 'current-motor-power',
          rawValue: motorLatest?.power_kw != null ? motorLatest.power_kw * 1000 : null,
          label: t('dynamics.power', 'Motor Power'),
          display: { units: { power: 'kW' } },
        }]}
        preferences={preferences}
        loading={query.isLoading && !state.hasData}
        retained={state.refreshError != null}
        period={{
          kind: 'snapshot',
          observedAt: motorLatest?.ts ?? null,
          label: t('dynamics.review.liveBadge', 'Current signals · not trip history'),
          provenance: t('dynamics.modernization.motorSource', 'Latest reported motor signals; not selected-trip history.'),
        }}
      />
      <StatGroup
        id="dynamics-range-speeds"
        metrics={speeds}
        preferences={preferences}
        period={{
          kind: 'unknown',
          label: t('dynamics.review.rangeAnalytics', 'Date-range trip context'),
          reason: t('dynamics.modernization.loadedSpeeds', 'Average and maximum of the loaded trips, including any current drive; not a complete-range aggregate.'),
        }}
      />
    </LayoutCard>
  );
}
