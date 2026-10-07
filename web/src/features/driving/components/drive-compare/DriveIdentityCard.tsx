import { useTranslation } from 'react-i18next';
import { CalendarClock, MapPin } from 'lucide-react';

import { RouteDisplay } from '@/components/data-display';
import { GlassPanel, Badge, MetricLabel, MetricValue, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime, formatTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { DriveDetail } from '@/types/driving';

import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';

interface DriveIdentityCardProps {
  side: 'a' | 'b';
  drive: DriveDetail | null;
  state: CompareSectionState;
}

export function DriveIdentityCard({ side, drive, state }: DriveIdentityCardProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration, formatTemperature } = useUnits();
  const sideLabel = side === 'a'
    ? t('driveCompare.driveA', 'Drive A')
    : t('driveCompare.driveB', 'Drive B');

  const battery = drive && (drive.startBatteryPct != null || drive.endBatteryPct != null)
    ? `${drive.startBatteryPct != null ? `${drive.startBatteryPct}%` : '—'} → ${drive.endBatteryPct != null ? `${drive.endBatteryPct}%` : '—'}`
    : '—';
  const status = drive?.live
    ? t('driveCompare.identity.inProgress', 'In progress')
    : drive?.endTs
      ? t('driveCompare.identity.completed', 'Completed')
      : t('driveCompare.identity.statusUnknown', 'Status unavailable');
  const conditions = drive?.outsideTempAvgC != null
    ? `${formatTemperature(drive.outsideTempAvgC, { precision: 0 })} · ${status}`
    : status;
  const facts = drive ? [
    {
      label: t('driveCompare.m.distance', 'Distance'),
      value: formatDistance(drive.distanceM, { precision: 1 }),
    },
    {
      label: t('driveCompare.m.duration', 'Duration'),
      value: formatDuration(drive.durationS, { precision: 0 }),
    },
    { label: t('driveCompare.identity.battery', 'Battery'), value: battery },
    { label: t('driveCompare.identity.conditions', 'Conditions'), value: conditions },
  ] : [];

  return (
    <GlassPanel
      className={cn(
        'p-5',
        side === 'a' ? 'border-cyan-400/20' : 'border-purple-400/20',
      )}
      data-testid={`drive-compare-identity-${side}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('driveCompare.identity.title', 'Drive {{side}} context', { side: side.toUpperCase() })}
        </PanelTitle>
        <Badge
          variant="info"
          className={cn(side === 'b' && 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200')}
        >
          {sideLabel}
        </Badge>
      </div>
      <CompareSectionBody
        state={state}
        icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
        resourceName={sideLabel}
        className="min-h-56"
      >
        {drive ? (
          <div className="space-y-5">
            <div>
              <Text as="p" variant="subhead">
                {formatDateTime(drive.startTs)}
                {drive.endTs ? ` – ${formatTime(drive.endTs)}` : ''}
              </Text>
              <div className="mt-2">
                <MetricLabel>{t('driveCompare.identity.route', 'Route')}</MetricLabel>
                <RouteDisplay
                  className="mt-1"
                  showIcon
                  start={{ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }}
                  end={{ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {facts.map((fact) => (
                <div
                  key={fact.label}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <MetricLabel>{fact.label}</MetricLabel>
                  <MetricValue className="mt-1 truncate">{fact.value}</MetricValue>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CompareSectionBody>
    </GlassPanel>
  );
}
