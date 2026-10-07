import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Route } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { Drive } from '@/types/driving';
import { isOpenDrive } from './pickDynamicsDrive';

interface RideOverviewProps {
  drive: Drive | null;
}

/** Drive-record facts, never populated from the current vehicle snapshot. */
export default function RideOverview({ drive }: RideOverviewProps) {
  const { t } = useTranslation();
  const { formatDistance, formatEnergy, formatDuration, formatSpeed } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const metrics = [
    { label: t('dynamics.ride.distance', 'Distance'), value: formatDistance(drive?.distanceM) },
    { label: t('dynamics.ride.duration', 'Duration'), value: formatDuration(drive?.durationS) },
    { label: t('dynamics.ride.energy', 'Energy used'), value: formatEnergy(drive?.energyUsedWh) },
    { label: t('dynamics.ride.recovered', 'Energy recovered'), value: formatEnergy(drive?.regenEnergyWh) },
  ];

  return (
    <GlassPanel className="min-w-0 overflow-hidden p-4 sm:p-6" data-testid="dynamics-ride-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          <Route className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
          {t('dynamics.ride.title', 'Selected ride')}
        </PanelTitle>
        <Badge variant={drive && isOpenDrive(drive) ? 'info' : 'neutral'} size="sm">
          {!drive ? t('dynamics.ride.unselected', 'No trip selected') : isOpenDrive(drive)
            ? t('dynamics.ride.open', 'In progress · totals may change')
            : t('dynamics.ride.recorded', 'Recorded trip')}
        </Badge>
      </div>
      {drive ? (
        <div className="mt-4 space-y-5">
          <div className="flex min-w-0 flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 space-y-2">
              <Text as="p" variant="body" weight="semibold" className="break-words">
                {drive.startAddress ?? t('dynamics.ride.unknownOrigin', 'Origin not recorded')}
                {' → '}
                {drive.endAddress ?? (isOpenDrive(drive)
                  ? t('dynamics.ride.onTheRoad', 'On the road')
                  : t('dynamics.ride.unknownDestination', 'Destination not recorded'))}
              </Text>
              <Text as="p" variant="caption">
                {formatDateTime(drive.startTs)}
                {' — '}
                {drive.endTs ? formatDateTime(drive.endTs) : t('dynamics.trip.inProgress', 'In progress')}
              </Text>
            </div>
            <Link
              to={`/drives/${drive.id}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-[var(--theme-primary)] underline-offset-4 hover:underline"
            >
              {t('dynamics.ride.details', 'Open trip details')}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
                <Text as="dt" variant="caption">{metric.label}</Text>
                <Text as="dd" size="2xl" weight="semibold" className="mt-1 break-words tabular-nums">
                  {metric.value}
                </Text>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border-default)] pt-4">
            <Text as="p" variant="bodySm">
              {t('dynamics.ride.speed', 'Average / peak speed: {{average}} / {{peak}}', {
                average: formatSpeed(drive.avgSpeedMps),
                peak: formatSpeed(drive.maxSpeedMps),
              })}
            </Text>
            <Text as="p" variant="bodySm">
              {t('dynamics.ride.battery', 'Battery: {{start}} → {{end}}', {
                start: drive.startBatteryPct != null ? `${fmtNumber(drive.startBatteryPct)}%` : '—',
                end: drive.endBatteryPct != null ? `${fmtNumber(drive.endBatteryPct)}%` : '—',
              })}
            </Text>
          </div>
          <Text as="p" variant="caption">
            {t('dynamics.ride.energyMeaning', 'Energy recovered is recorded regeneration, not peak regen power. Missing measurements remain unknown; these totals do not rate driving style.')}
          </Text>
        </div>
      ) : (
        <EmptyState /* no-action: select a drive using the adjacent trip selector */
          message={t('dynamics.ride.empty', 'Choose a trip with recorded data to review its outcome.')}
        />
      )}
    </GlassPanel>
  );
}
