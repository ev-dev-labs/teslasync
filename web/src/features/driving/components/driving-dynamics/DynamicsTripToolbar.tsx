import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';

import { Badge, GlassPanel, PanelTitle, Select, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { Drive } from '@/types/driving';

import { isOpenDrive } from './pickDynamicsDrive';

interface DynamicsTripToolbarProps {
  startDate: string;
  endDate: string;
  drives: Drive[];
  selectedDriveId: string;
  onSelectDrive: (driveId: string) => void;
}

export default function DynamicsTripToolbar({
  startDate,
  endDate,
  drives,
  selectedDriveId,
  onSelectDrive,
}: DynamicsTripToolbarProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const items = drives ?? [];
  const selected = items.find((drive) => String(drive.id) === selectedDriveId);
  const options = useMemo(
    () =>
      items.map((drive) => {
        const when = drive.startTs
          ? formatDateTime(drive.startTs)
          : t('dynamics.trip.unknownStart', 'Unknown start');
        const dist = formatDistance(drive.distanceM ?? 0);
        const open = isOpenDrive(drive)
          ? t('dynamics.trip.inProgress', 'In progress')
          : dist;
        return {
          value: String(drive.id),
          label: `${when} · ${open}`,
        };
      }),
    [items, formatDistance, t],
  );

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="dynamics-trip-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="mb-0 flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('dynamics.trip.title', 'Trip review')}
        </PanelTitle>
        {selected && isOpenDrive(selected) ? (
          <Badge variant="success" size="sm">
            {t('dynamics.trip.liveDrive', 'Current drive')}
          </Badge>
        ) : null}
      </div>
      <Text as="p" variant="caption">
        {t(
          'dynamics.trip.subtitle',
          'Live gauges stay on now. Charts and motor stats are one drive — in progress if the car is moving, otherwise the trip you pick.',
        )}{' '}
        {startDate} – {endDate}
      </Text>
      <Select
        id="dynamics-drive"
        label={t('dynamics.trip.drive', 'Drive')}
        options={options}
        value={selectedDriveId}
        onChange={(event) => onSelectDrive(event.target.value)}
        placeholder={t('dynamics.trip.noDrives', 'No drives in this range')}
        disabled={options.length === 0}
        size="auto"
      />
    </GlassPanel>
  );
}
