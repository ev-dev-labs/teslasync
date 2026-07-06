import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { KVList, DateTime } from '@/components/data-display';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { TripDetail } from '@/api/types';

interface TripOverviewPanelProps {
  trip: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Trip metadata panel — the original KVList section, self-sufficient with
 *  its own loading / error / empty states. */
export function TripOverviewPanel({ trip, isLoading, isError, error, onRetry }: TripOverviewPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Info className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('trips.detail.overview', 'Overview')}
      </PanelTitle>
      {isLoading && !trip ? (
        <Skeleton height={260} />
      ) : isError ? (
        <QueryError
          error={error}
          resourceName={t('trips.detail.resourceName', 'Trip')}
          listHref="/trips"
          onRetry={onRetry}
        />
      ) : !trip ? (
        <EmptyState /* no-action: transient empty state — surfaces when the trip record is unavailable */
          message={t('trips.detail.notFound', 'Trip not found')}
        />
      ) : (
        <KVList
          items={[
            { label: t('trips.detail.tripId', 'Trip ID'), value: String(trip.id) },
            // Treat blank / whitespace-only names as "no name" so the row shows
            // an em-dash instead of an empty cell (the API can emit name: "").
            { label: t('trips.detail.name', 'Name'), value: trip.name?.trim() ? trip.name : '—' },
            { label: t('trips.detail.vehicle', 'Vehicle'), value: `#${trip.vehicle_id}` },
            { label: t('trips.detail.started', 'Started'), value: <DateTime value={trip.start_date} variant="full" /> },
            {
              label: t('trips.detail.ended', 'Ended'),
              value: trip.end_date
                ? <DateTime value={trip.end_date} variant="full" />
                : t('trips.detail.inProgress', 'In progress'),
            },
            {
              label: t('trips.detail.duration', 'Duration'),
              value: (trip.total_duration_s ?? 0) > 0
                ? formatDurationSecondsAsMinutes(trip.total_duration_s)
                : '—',
            },
            { label: t('trips.detail.drives', 'Drives'), value: String(trip.drive_count ?? 0) },
            { label: t('trips.detail.charges', 'Charges'), value: String(trip.charge_count ?? 0) },
            { label: t('trips.detail.created', 'Created'), value: <DateTime value={trip.created_at} variant="full" /> },
            // Only surface the Notes row when there is non-whitespace content —
            // a whitespace-only note is effectively empty and would render blank.
            ...(trip.notes?.trim() ? [{ label: t('trips.detail.notes', 'Notes'), value: trip.notes }] : []),
          ]}
        />
      )}
    </GlassPanel>
  );
}
