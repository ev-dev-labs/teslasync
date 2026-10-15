import { CalendarDays } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { DataTable, Text, StatusPill, type Column } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { formatDayKey } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { FleetReservation } from '@/api/hooks/useFleetOps';
import type { DataState } from '@/api/dataState';
import { ReservationActions } from './ReservationActions';
import { reservationCalendarDays } from '../helpers';

interface ReservationPanelProps {
  items: FleetReservation[];
  enableValueFilters?: boolean;
  loading: boolean;
  source?: DataState<unknown>;
  pendingContent?: ReactNode;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetReservation) => void;
  onCancel: (item: FleetReservation) => void;
  onDelete: (item: FleetReservation) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

const statusColor: Record<FleetReservation['status'], string> = {
  requested: 'bg-[var(--semantic-warning)]',
  confirmed: 'bg-[var(--semantic-success)]',
  cancelled: 'bg-[var(--semantic-danger)]',
  completed: 'bg-[var(--text-secondary)]',
};

export function ReservationPanel({
  items,
  enableValueFilters = false,
  loading,
  source,
  pendingContent,
  error,
  onRetry,
  onAdd,
  onEdit,
  onCancel,
  onDelete,
  actionsDisabled = false,
  actionsDisabledReason,
}: ReservationPanelProps) {
  const { t } = useTranslation();
  const { formatDateTime, formatTime, opts, tz } = useDateFormat();
  const upcoming = items.filter((item) => item.status === 'requested' || item.status === 'confirmed');
  const calendarDays = reservationCalendarDays(upcoming, tz).slice(0, 5);
  const statusLabel = (status: FleetReservation['status']) => ({
    requested: t('fleetOps.status.requested', 'Requested'),
    confirmed: t('fleetOps.status.confirmed', 'Confirmed'),
    cancelled: t('fleetOps.status.cancelled', 'Cancelled'),
    completed: t('fleetOps.status.completed', 'Completed'),
  }[status]);
  const columns = useMemo<Column<FleetReservation>[]>(() => [
    {
      key: 'title',
      header: t('fleetOps.reservations.reservation', 'Reservation'),
      filterValue: (item) => item.id,
      filterValueLabel: (_value, item) => item.title,
      render: (item) => item.title,
      visibleOnMobile: true,
    },
    {
      key: 'vehicle',
      header: t('fleetOps.reservations.vehicle', 'Vehicle'),
      filterValue: (item) => item.vehicle_id ?? null,
      filterValueLabel: (_value, item) => item.vehicle_display_name,
      render: (item) => item.vehicle_display_name,
      visibleOnMobile: true,
    },
    {
      key: 'driver',
      header: t('fleetOps.reservations.driver', 'Driver'),
      filterValue: (item) => item.driver_id ?? null,
      filterValueLabel: (_value, item) => item.driver_display_name ?? '—',
      render: (item) => item.driver_display_name ?? '—',
    },
    {
      key: 'period',
      header: t('fleetOps.reservations.period', 'Period'),
      render: (item) => `${formatDateTime(item.starts_at)} – ${formatDateTime(item.ends_at)}`,
    },
    {
      key: 'status',
      header: t('fleetOps.reservations.status', 'Status'),
      filterValue: (item) => item.status ?? null,
      filterValueLabel: (_value, item) => item.status == null ? '—' : statusLabel(item.status),
      render: (item) => (
        <StatusPill color={statusColor[item.status]}>{statusLabel(item.status)}</StatusPill>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions', 'Actions'),
      align: 'right',
      render: (item) => (
        <ReservationActions
          item={item}
          onEdit={onEdit}
          onCancel={onCancel}
          onDelete={onDelete}
          disabled={actionsDisabled}
          disabledReason={actionsDisabledReason}
        />
      ),
    },
  ], [
    actionsDisabled,
    actionsDisabledReason,
    onCancel,
    onDelete,
    onEdit,
    formatDateTime,
    t,
  ]);

  return (
    <LayoutCard title={t('fleetOps.reservations.title', 'Reservation calendar')}>
      {source?.hasData !== true && error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.reservations.resource', 'Reservations')} />
      ) : source && !source.hasData ? (
        pendingContent
      ) : !source && loading ? <Skeleton lines={7} /> : items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          message={t('fleetOps.reservations.empty', 'No reservations found.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.reservations.add', 'Add reservation'), onClick: onAdd }}
        />
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {calendarDays.map(({ day, reservations }) => (
              <div key={day ?? 'unknown'} className="min-h-28 min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                <Text as="p" weight="semibold">{day ? formatDayKey(day, { ...opts, style: 'short' }) : '—'}</Text>
                <div className="mt-2 space-y-2">
                  {reservations.map((item) => (
                    <div key={item.id} className="min-w-0 rounded-lg bg-[var(--surface-1)] p-2">
                      <Text as="p" weight="medium" className="break-words">{item.title}</Text>
                      <Text as="p" variant="caption" className="mt-1 break-words">{formatTime(item.starts_at)} · {item.vehicle_display_name}</Text>
                      <ReservationActions
                        item={item}
                        onEdit={onEdit}
                        onCancel={onCancel}
                        onDelete={onDelete}
                        disabled={actionsDisabled}
                        disabledReason={actionsDisabledReason}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DataTable
            tableId="fleet-ops:reservations"
            caption={t('fleetOps.reservations.title', 'Reservation calendar')}
            columns={columns}
            data={items}
            enableValueFilters={enableValueFilters}
            keyExtractor={(item) => item.id}
            mobileColumns={['title', 'vehicle', 'actions']}
            mobilePresentation={{
              roles: { title: 'title', vehicle: 'primary', period: 'meta', status: 'badge' },
              displayValue: (item, key) => {
                switch (key) {
                  case 'title': return item.title;
                  case 'vehicle': return item.vehicle_display_name;
                  case 'driver': return item.driver_display_name;
                  case 'period': return `${formatDateTime(item.starts_at)} – ${formatDateTime(item.ends_at)}`;
                  case 'status': return statusLabel(item.status);
                  default: return null;
                }
              },
              inlineActions: (item) => columns.find((column) => column.key === 'actions')?.render(item),
            }}
            pagination
          />
        </div>
      )}
    </LayoutCard>
  );
}
