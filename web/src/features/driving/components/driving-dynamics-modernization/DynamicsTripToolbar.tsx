import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Select, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { Drive } from '@/types/driving';
import { isOpenDrive } from '../driving-dynamics/pickDynamicsDrive';

interface DynamicsTripToolbarProps {
  startDate: string;
  endDate: string;
  drives: Drive[];
  selectedDriveId: string;
  onSelectDrive: (driveId: string) => void;
}

/** Drive is an independent business selector, not another workspace scope. */
export default function DynamicsTripToolbar({
  startDate, endDate, drives, selectedDriveId, onSelectDrive,
}: DynamicsTripToolbarProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const items = drives ?? [];
  const selected = items.find(drive => String(drive.id) === selectedDriveId);
  const options = useMemo(() => items.map(drive => {
    const when = drive.startTs ? formatDateTime(drive.startTs)
      : t('dynamics.trip.unknownStart', 'Unknown start');
    // An absent distance is not a stationary, zero-distance drive.
    const dist = formatDistance(drive.distanceM);
    const open = isOpenDrive(drive)
      ? t('dynamics.trip.inProgress', 'In progress') : dist;
    return { value: String(drive.id), label: `${when} · ${open}` };
  }), [items, formatDistance, t]);

  return (
    <div className="w-full min-w-0" data-testid="dynamics-trip-toolbar">
      <LayoutCard
        title={t('dynamics.trip.title', 'Trip review')}
        actions={selected && isOpenDrive(selected) ? (
          <Badge variant="success" size="sm">
            {t('dynamics.trip.liveDrive', 'Current drive')}
          </Badge>
        ) : undefined}
      >
        <Text as="p" variant="caption">
          {t('dynamics.trip.reviewDescription', 'Choose a ride to review its recorded outcome and motor samples. Current vehicle signals and multi-trip context are separated below.')}
          {' '}{startDate} – {endDate}
        </Text>
        <Select
          id="dynamics-drive"
          label={t('dynamics.trip.drive', 'Drive')}
          options={options}
          value={selectedDriveId}
          onChange={event => onSelectDrive(event.target.value)}
          placeholder={t('dynamics.trip.noDrives', 'No drives in this range')}
          disabled={options.length === 0}
          size="auto"
        />
      </LayoutCard>
    </div>
  );
}
