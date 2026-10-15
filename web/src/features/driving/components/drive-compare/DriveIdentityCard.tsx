import { useTranslation } from 'react-i18next';
import { CalendarClock, MapPin } from 'lucide-react';

import { RouteDisplay } from '@/components/data-display';
import { GlassPanel, Badge, MetricLabel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
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
  const { formatDateTime, formatTime } = useDateFormat();
  const { fmtPercent } = useNumberFormatting();
  const sideLabel = side === 'a'
    ? t('driveCompare.driveA', 'Drive A')
    : t('driveCompare.driveB', 'Drive B');

  const batteryEndpoint = (value: unknown) => isFiniteNumber(value) ? fmtPercent(value) : '—';
  const battery = `${batteryEndpoint(drive?.startBatteryPct)} → ${batteryEndpoint(drive?.endBatteryPct)}`;
  const status = drive?.live
    ? t('driveCompare.identity.inProgress', 'In progress')
    : drive?.endTs
      ? t('driveCompare.identity.completed', 'Completed')
      : t('driveCompare.identity.statusUnknown', 'Status unavailable');
  const conditions = drive?.outsideTempAvgC != null
    ? `${formatTemperature(drive.outsideTempAvgC)} · ${status}`
    : status;
  const facts = drive ? [
    {
      label: t('driveCompare.m.distance', 'Distance'),
      value: formatDistance(drive.distanceM),
    },
    {
      label: t('driveCompare.m.duration', 'Duration'),
      value: formatDuration(drive.durationS),
    },
    { label: t('driveCompare.identity.battery', 'Battery'), value: battery },
    { label: t('driveCompare.identity.conditions', 'Conditions'), value: conditions },
  ] : [];

  return (
    <GlassPanel
      className="min-w-0 border-[var(--border-subtle)] p-4 sm:p-5"
      data-testid={`drive-compare-identity-${side}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="flex min-w-0 items-center gap-2 break-words">
          <CalendarClock className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          {t('driveCompare.identity.title', 'Drive {{side}} context', { side: side.toUpperCase() })}
        </PanelTitle>
        <Badge variant="neutral">
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
              <Text as="p" variant="subhead" className="whitespace-normal break-words">
                {formatDateTime(drive.startTs)}
                {drive.endTs ? ` – ${formatTime(drive.endTs)}` : ''}
              </Text>
              <div className="mt-2">
                <MetricLabel>{t('driveCompare.identity.route', 'Route')}</MetricLabel>
                <RouteDisplay
                  className="mt-1 items-start overflow-visible whitespace-normal break-words [&>span]:min-w-0 [&>span]:whitespace-normal [&>span]:overflow-visible [&>span]:break-words"
                  showIcon
                  start={{ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }}
                  end={{ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {facts.map((fact) => (
                <div
                  key={fact.label}
                  className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <MetricLabel>{fact.label}</MetricLabel>
                  <Text
                    as="div"
                    variant="body"
                    className="mt-1 whitespace-normal break-words"
                  >
                    {fact.value}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CompareSectionBody>
    </GlassPanel>
  );
}
