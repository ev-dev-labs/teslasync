import { CalendarDays } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { DataTable, Text, StatusPill, type Column } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { formatDateShort, formatDateTime, formatTime } from '@/lib/dateFormat';
import type { FleetReservation } from '@/api/hooks/useFleetOps';
import { ReservationActions } from './ReservationActions';

interface ReservationPanelProps {
  items: FleetReservation[];
  enableValueFilters?: boolean;
  loading: boolean;
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
  requested: 'bg-amber-500',
  confirmed: 'bg-emerald-500',
  cancelled: 'bg-rose-500',
  completed: 'bg-slate-500',
};

export function ReservationPanel({
  items,
  enableValueFilters = false,
  loading,
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
  const upcoming = items.filter((item) => item.status === 'requested' || item.status === 'confirmed');
  const calendarDays = [...new Set(upcoming.map((item) => item.starts_at.slice(0, 10)))].slice(0, 5);
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
    t,
  ]);

  return (
    <LayoutCard title={t('fleetOps.reservations.title', 'Reservation calendar')}>
      {loading ? <Skeleton lines={7} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.reservations.resource', 'Reservations')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          message={t('fleetOps.reservations.empty', 'No reservations in this planning window.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.reservations.add', 'Add reservation'), onClick: onAdd }}
        />
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {calendarDays.map((day) => (
              <div key={day} className="min-h-28 min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                <Text as="p" weight="semibold">{formatDateShort(day)}</Text>
                <div className="mt-2 space-y-2">
                  {upcoming.filter((item) => item.starts_at.startsWith(day)).map((item) => (
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
            columns={columns}
            data={items}
            enableValueFilters={enableValueFilters}
            keyExtractor={(item) => item.id}
            mobileColumns={['title', 'vehicle', 'actions']}
            pagination
          />
        </div>
      )}
    </LayoutCard>
  );
}
