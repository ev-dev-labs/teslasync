import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';
import { GlassPanel, PanelTitle, DataTable, Text, type Column } from '@/components/ui';
import { RouteDisplay, DateTime } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { TripDetail, TripDriveSummary } from '@/api/types';

interface TripDrivesTableProps {
  trip: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Full-width detail band listing every drive inside the trip, with its own
 *  loading / error / empty states. */
export function TripDrivesTable({ trip, isLoading, isError, error, onRetry }: TripDrivesTableProps) {
  const { t } = useTranslation();
  const { formatDistance, formatEnergy } = useUnits();

  const drives = trip?.drives ?? [];

  const columns = useMemo<Column<TripDriveSummary>[]>(
    () => [
      {
        key: 'route',
        header: t('trips.detail.table.route', 'Route'),
        render: (d) => (
          <RouteDisplay
            start={{ address: d.start_place }}
            end={{ address: d.end_place }}
          />
        ),
      },
      {
        key: 'started_at',
        header: t('trips.detail.table.started', 'Started'),
        sortable: true,
        render: (d) => <DateTime value={d.started_at} variant="short" className="text-sm" />,
      },
      {
        key: 'distance_m',
        header: t('trips.detail.table.distance', 'Distance'),
        sortable: true,
        render: (d) => (
          <Text variant="body" className="tabular-nums">
            {formatDistance(d.distance_m)}
          </Text>
        ),
      },
      {
        key: 'energy_used_wh',
        header: t('trips.detail.table.energy', 'Energy'),
        sortable: true,
        render: (d) => (
          <Text variant="body" className="tabular-nums">
            {formatEnergy(d.energy_used_wh)}
          </Text>
        ),
      },
      {
        key: 'duration_s',
        header: t('trips.detail.table.duration', 'Duration'),
        sortable: true,
        render: (d) => (
          <Text size="sm" color="secondary" className="tabular-nums">
            {(d.duration_s ?? 0) > 0 ? formatDurationSecondsAsMinutes(d.duration_s) : '—'}
          </Text>
        ),
      },
    ],
    [t, formatDistance, formatEnergy],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('trips.detail.drivesTitle', 'Drives in this trip')}
      </PanelTitle>
      {isLoading && !trip ? (
        <Skeleton height={240} />
      ) : isError ? (
        <QueryError
          error={error}
          resourceName={t('trips.detail.resourceName', 'Trip')}
          listHref="/trips"
          onRetry={onRetry}
        />
      ) : (
        <DataTable
          tableId="trips:trip-detail-drives"
          columns={columns}
          data={drives}
          keyExtractor={(d) => d.id}
          emptyMessage={t('trips.detail.drivesEmpty', 'No drives recorded for this trip')}
          pagination
        />
      )}
    </GlassPanel>
  );
}
