import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button, Text, Subhead, StatusPill } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { formatDate } from '@/lib/dateFormat';
import type { FleetWorkOrder, WorkOrderStatus } from '@/api/hooks/useFleetOps';

interface WorkOrderBoardProps {
  items: FleetWorkOrder[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetWorkOrder) => void;
  onDelete: (item: FleetWorkOrder) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

const columns: WorkOrderStatus[] = ['open', 'scheduled', 'in_progress', 'completed', 'cancelled'];
const severityColor: Record<FleetWorkOrder['severity'], string> = {
  low: 'bg-sky-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  critical: 'bg-rose-500',
};

export function WorkOrderBoard({
  items,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
  actionsDisabled = false,
  actionsDisabledReason,
}: WorkOrderBoardProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const statusLabel = (status: WorkOrderStatus) => ({
    open: t('fleetOps.workOrders.open', 'Open'),
    scheduled: t('fleetOps.workOrders.scheduled', 'Scheduled'),
    in_progress: t('fleetOps.workOrders.inProgress', 'In progress'),
    completed: t('fleetOps.workOrders.completed', 'Completed'),
    cancelled: t('fleetOps.workOrders.cancelled', 'Cancelled'),
  }[status]);
  const severityLabel = (severity: FleetWorkOrder['severity']) => ({
    low: t('fleetOps.workOrders.low', 'Low'),
    medium: t('fleetOps.workOrders.medium', 'Medium'),
    high: t('fleetOps.workOrders.high', 'High'),
    critical: t('fleetOps.workOrders.critical', 'Critical'),
  }[severity]);

  return (
    <LayoutCard title={t('fleetOps.workOrders.title', 'Maintenance work-order board')} actions={
        <Button type="button" size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd} disabled={actionsDisabled} title={actionsDisabledReason}>
          {t('fleetOps.workOrders.add', 'Add work order')}
        </Button>
      }>
      {loading ? <Skeleton lines={8} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.workOrders.resource', 'Work orders')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-8 w-8" />}
          message={t('fleetOps.workOrders.empty', 'No maintenance work orders are open.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.workOrders.add', 'Add work order'), onClick: onAdd }}
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-5">
          {columns.map((status) => {
            const statusItems = items.filter((item) => item.status === status);
            return (
              <section key={status} aria-label={statusLabel(status)} className="min-w-0 rounded-xl bg-[var(--surface-2)] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <Subhead>{statusLabel(status)}</Subhead>
                  <Text variant="caption">{statusItems.length}</Text>
                </div>
                <div className="space-y-2">
                  {statusItems.length === 0 ? (
                    <Text as="p" variant="caption" className="py-6 text-center">
                      {t('fleetOps.workOrders.noneInColumn', 'No orders')}
                    </Text>
                  ) : statusItems.map((item) => (
                    <article key={item.id} className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-1)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Text as="p" weight="medium" className="min-w-0 break-words">{item.title}</Text>
                        <StatusPill color={severityColor[item.severity]}>{severityLabel(item.severity)}</StatusPill>
                      </div>
                      <Text as="p" variant="caption" className="mt-1 break-words">{item.vehicle_display_name}</Text>
                      <Text as="p" variant="caption" className="mt-2">
                        {item.due_at
                          ? t('fleetOps.workOrders.dueDate', 'Due {{date}}', { date: formatDate(item.due_at) })
                          : item.due_odometer_m != null
                            ? t('fleetOps.workOrders.dueDistance', 'Due at {{distance}}', { distance: formatDistance(item.due_odometer_m) })
                            : t('fleetOps.workOrders.noDue', 'No due threshold')}
                      </Text>
                      <div className="mt-2 flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-11 px-0"
                          aria-label={t('fleetOps.workOrders.edit', 'Edit {{name}}', { name: item.title })}
                          disabled={actionsDisabled}
                          title={actionsDisabledReason}
                          onClick={() => onEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-11 px-0 text-rose-300"
                          aria-label={t('fleetOps.workOrders.delete', 'Delete {{name}}', { name: item.title })}
                          disabled={actionsDisabled}
                          title={actionsDisabledReason}
                          onClick={() => onDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </LayoutCard>
  );
}
