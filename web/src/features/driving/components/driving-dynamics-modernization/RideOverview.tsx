import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup, type StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { Drive } from '@/types/driving';
import { isOpenDrive } from '../driving-dynamics/pickDynamicsDrive';

/** Drive-record facts remain independent of the current vehicle snapshot. */
export default function RideOverview({ drive }: { drive: Drive | null }) {
  const { t } = useTranslation();
  const { formatSpeed, unitPrefs } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'ride-distance', rawValue: drive?.distanceM,
      label: t('dynamics.ride.distance', 'Distance'), display: { precision: unitPrefs.precision ?? 1 } },
    { metricId: 'duration', occurrenceId: 'ride-duration', rawValue: drive?.durationS,
      label: t('dynamics.ride.duration', 'Duration'), display: { precision: unitPrefs.precision ?? 0 } },
    { metricId: 'energy', occurrenceId: 'ride-energy-used', rawValue: drive?.energyUsedWh,
      label: t('dynamics.ride.energy', 'Energy used'), display: { precision: unitPrefs.precision ?? 2 } },
    { metricId: 'energy', occurrenceId: 'ride-energy-recovered', rawValue: drive?.regenEnergyWh,
      label: t('dynamics.ride.recovered', 'Energy recovered'), display: { precision: unitPrefs.precision ?? 2 } },
  ];

  return (
    <div data-testid="dynamics-ride-overview" className="h-full min-w-0">
      <LayoutCard
        title={t('dynamics.ride.title', 'Selected ride')}
        actions={
          <Badge variant={drive && isOpenDrive(drive) ? 'info' : 'neutral'} size="sm">
            {!drive ? t('dynamics.ride.unselected', 'No trip selected') : isOpenDrive(drive)
              ? t('dynamics.ride.open', 'In progress · totals may change')
              : t('dynamics.ride.recorded', 'Recorded trip')}
          </Badge>
        }
      >
        {drive ? (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 flex-col justify-between gap-3 @3xl:flex-row @3xl:items-start">
              <div className="min-w-0 space-y-2">
                <Text as="p" variant="body" weight="semibold" className="break-words">
                  {drive.startAddress ?? t('dynamics.ride.unknownOrigin', 'Origin not recorded')}
                  {' → '}
                  {drive.endAddress ?? (isOpenDrive(drive)
                    ? t('dynamics.ride.onTheRoad', 'On the road')
                    : t('dynamics.ride.unknownDestination', 'Destination not recorded'))}
                </Text>
                <Text as="p" variant="caption">
                  {formatDateTime(drive.startTs)}{' — '}
                  {drive.endTs ? formatDateTime(drive.endTs) : t('dynamics.trip.inProgress', 'In progress')}
                </Text>
              </div>
              <Link to={`/drives/${drive.id}`}
                className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-[var(--theme-primary)] underline-offset-4 hover:underline">
                {t('dynamics.ride.details', 'Open trip details')}
              </Link>
            </div>
            <StatGroup
              id="dynamics-ride-metrics"
              metrics={metrics}
              preferences={{ units: unitPrefs, currency: { kind: 'symbol', value: '' } }}
              period={{
                kind: 'event',
                eventId: String(drive.id),
                start: drive.startTs,
                end: drive.endTs ?? null,
                label: t('dynamics.ride.title', 'Selected ride'),
                provenance: t('dynamics.modernization.rideSource', 'Recorded drive totals; missing measurements remain unknown.'),
              }}
            />
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
          // no-action: The trip selector immediately above this card already owns ride selection.
          <EmptyState message={t('dynamics.ride.empty', 'Choose a trip with recorded data to review its outcome.')} />
        )}
      </LayoutCard>
    </div>
  );
}
