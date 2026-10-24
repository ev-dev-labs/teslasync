import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Flag } from 'lucide-react';
import { VisuallyHidden } from '@/components/a11y';
import { Text } from '@/components/ui';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { resolveTimezone } from '@/lib/timezone';
import type { DriveDetail } from '@/types/driving';
import { formatCoordinates } from './JourneyDetailsPanel';

export interface JourneySequenceProps {
  drive: DriveDetail;
  /** Pre-formatted distance and duration of the leg between the endpoints. */
  distance: ReactNode;
  duration: ReactNode;
  /** Optional comparisons for the leg (e.g. vs this vehicle's average). */
  comparisons?: ReactNode[];
}

/**
 * The journey told in order — Start, the leg (distance and duration), then
 * Destination — each endpoint with its place, time and battery. Uses the same
 * place, coordinate and timezone rules as the journey details table.
 */
export function JourneySequence({ drive, distance, duration, comparisons = [] }: JourneySequenceProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { data: vehicle } = useVehicle(String(drive.vehicleId));
  const { settings } = useSettings();
  const { formatDateTime } = useDateFormat();
  const timezone = resolveTimezone(
    settings.tz_display_default === 'user' || settings.tz_display_default === 'utc'
      ? settings.tz_display_default : 'vehicle',
    vehicle?.timezone, settings.timezone_user,
  );
  const hasEnded = Boolean(drive.endTs);
  const battery = (pct: number | null | undefined) => (pct != null ? `${fmtNumber(pct)}%` : '—');
  const place = (address: string | null | undefined, coords: string | null, fallback: string) =>
    address ? address : coords ? <span className="font-mono">{coords}</span> : fallback;

  const startCoords = formatCoordinates(drive.startLat, drive.startLon);
  const endCoords = formatCoordinates(drive.endLat, drive.endLon);
  const endpoints = [
    {
      id: 'start',
      icon: MapPin,
      label: t('driveDetail.start', 'Start'),
      place: place(drive.startAddress, startCoords, t('driveDetail.noAddress', 'No address data')),
      time: <time dateTime={drive.startTs}>{formatDateTime(drive.startTs, { tz: timezone })}</time>,
      battery: battery(drive.startBatteryPct),
    },
    {
      id: 'destination',
      icon: Flag,
      label: t('driveDetail.destination', 'Destination'),
      place: place(drive.endAddress, endCoords, hasEnded ? t('driveDetail.noAddress', 'No address data') : t('driveDetail.inProgress', 'In progress')),
      time: hasEnded
        ? <time dateTime={drive.endTs ?? undefined}>{formatDateTime(drive.endTs, { tz: timezone })}</time>
        : t('driveDetail.inProgress', 'In progress'),
      battery: battery(drive.endBatteryPct),
    },
  ];

  const endpoint = (item: typeof endpoints[number]) => (
    <li key={item.id} className="flex min-w-0 gap-3" data-journey-endpoint={item.id}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-2)]" aria-hidden="true">
        <item.icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
      </span>
      <div className="min-w-0 flex-1">
        <Text as="p" variant="caption">{item.label}</Text>
        <Text as="p" variant="bodySm" weight="semibold" color="primary" className="break-words [overflow-wrap:anywhere]">{item.place}</Text>
        <Text as="p" variant="caption" className="mt-0.5">
          {item.time}
          <span aria-hidden="true"> · </span>
          {t('driveDetail.battery', 'Battery')} {item.battery}
        </Text>
      </div>
    </li>
  );

  return (
    <ol aria-label={t('driveDetail.timeline.label', 'Drive timeline')} className="min-w-0 space-y-1" data-testid="journey-sequence">
      {endpoint(endpoints[0])}
      <li className="flex min-w-0 gap-3" data-journey-leg>
        <span className="flex w-7 shrink-0 justify-center" aria-hidden="true">
          <span className="h-full min-h-8 border-s-2 border-dashed border-[var(--border-strong)]" />
        </span>
        <div className="min-w-0 py-1.5">
          <Text as="p" variant="bodySm" weight="medium" color="primary" className="tabular-nums">
            <VisuallyHidden>{t('driveDetail.distance', 'Distance')}: </VisuallyHidden>{distance}
            <span aria-hidden="true"> · </span>
            <VisuallyHidden>{t('driveDetail.duration', 'Duration')}: </VisuallyHidden>{duration}
          </Text>
          {comparisons.some(Boolean) ? (
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">{comparisons.filter(Boolean).map((item, index) => <span key={index}>{item}</span>)}</div>
          ) : null}
        </div>
      </li>
      {endpoint(endpoints[1])}
    </ol>
  );
}
