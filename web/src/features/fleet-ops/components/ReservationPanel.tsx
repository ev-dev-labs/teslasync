import { CalendarDays } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { DataTable, GlassPanel, PanelTitle, StatusPill, type Column } from '@/components/ui';
import { formatDateShort, formatDateTime, formatTime } from '@/lib/dateFormat';
import type { FleetReservation } from '@/api/hooks/useFleetOps';
import { ReservationActions } from './ReservationActions';

interface ReservationPanelProps {
  items: FleetReservation[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit: (item: FleetReservation) => void;
  onCancel: (item: FleetReservation) => void;
  onDelete: (item: FleetReservation) => void;
}

const statusColor: Record<FleetReservation['status'], string> = {
  requested: 'bg-amber-500',
  confirmed: 'bg-emerald-500',
  cancelled: 'bg-rose-500',
  completed: 'bg-slate-500',
};

export function ReservationPanel({
  items,
  loading,
  error,
  onRetry,
  onEdit,
  onCancel,
  onDelete,
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
      render: (item) => item.title,
      visibleOnMobile: true,
    },
    {
      key: 'vehicle',
      header: t('fleetOps.reservations.vehicle', 'Vehicle'),
      render: (item) => item.vehicle_display_name,
      visibleOnMobile: true,
    },
    {
      key: 'driver',
      header: t('fleetOps.reservations.driver', 'Driver'),
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
        />
      ),
    },
  ], [onCancel, onDelete, onEdit, t]);

  return (
    <GlassPanel className="p-5">
      <PanelTitle>{t('fleetOps.reservations.title', 'Reservation calendar')}</PanelTitle>
      {loading ? <Skeleton lines={7} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.reservations.resource', 'Reservations')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          message={t('fleetOps.reservations.empty', 'No reservations in this planning window.')}
        />
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {calendarDays.map((day) => (
              <div key={day} className="min-h-28 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDateShort(day)}</p>
                <div className="mt-2 space-y-2">
                  {upcoming.filter((item) => item.starts_at.startsWith(day)).map((item) => (
                    <div key={item.id} className="rounded-lg bg-cyan-500/10 p-2 text-xs text-cyan-200">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="mt-1 text-[var(--text-muted)]">{formatTime(item.starts_at)} · {item.vehicle_display_name}</p>
                      <ReservationActions
                        item={item}
                        onEdit={onEdit}
                        onCancel={onCancel}
                        onDelete={onDelete}
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
            keyExtractor={(item) => item.id}
            mobileColumns={['title', 'vehicle', 'actions']}
            pagination
          />
        </div>
      )}
    </GlassPanel>
  );
}
