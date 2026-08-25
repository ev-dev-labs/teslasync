import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button, GlassPanel, PanelTitle, StatusPill } from '@/components/ui';
import type {
  FleetCostCenter,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { costCenterAllocations, formatMinorUnits } from '../helpers';

interface CostCenterAllocationProps {
  costCenters: FleetCostCenter[];
  reservations: FleetReservation[];
  workOrders: FleetWorkOrder[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetCostCenter) => void;
  onDelete: (item: FleetCostCenter) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

export function CostCenterAllocation({
  costCenters,
  reservations,
  workOrders,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
  actionsDisabled = false,
  actionsDisabledReason,
}: CostCenterAllocationProps) {
  const { t } = useTranslation();
  const allocations = costCenterAllocations(costCenters, reservations, workOrders);
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle>{t('fleetOps.costCenters.title', 'Cost-center allocation')}</PanelTitle>
        <Button
          type="button"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={onAdd}
          disabled={actionsDisabled}
          title={actionsDisabledReason}
        >
          {t('fleetOps.costCenters.add', 'Add cost center')}
        </Button>
      </div>
      {loading ? <Skeleton lines={5} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.costCenters.resource', 'Cost centers')} />
      ) : allocations.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          message={t('fleetOps.costCenters.empty', 'No cost centers have been configured.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.costCenters.add', 'Add cost center'), onClick: onAdd }}
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allocations.map((allocation) => (
            <div key={allocation.cost_center.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{allocation.cost_center.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{allocation.cost_center.code}</p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusPill color={allocation.cost_center.active ? 'bg-emerald-500' : 'bg-slate-500'}>
                    {allocation.cost_center.active
                      ? t('fleetOps.costCenters.active', 'Active')
                      : t('fleetOps.costCenters.inactive', 'Inactive')}
                  </StatusPill>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 px-0"
                    aria-label={t('fleetOps.costCenters.edit', 'Edit {{name}}', { name: allocation.cost_center.name })}
                    disabled={actionsDisabled}
                    title={actionsDisabledReason}
                    onClick={() => onEdit(allocation.cost_center)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 px-0 text-rose-300"
                    aria-label={t('fleetOps.costCenters.delete', 'Delete {{name}}', { name: allocation.cost_center.name })}
                    disabled={actionsDisabled}
                    title={actionsDisabledReason}
                    onClick={() => onDelete(allocation.cost_center)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[var(--text-muted)]">{t('fleetOps.costCenters.bookings', 'Bookings')}</p>
                  <p className="font-semibold">{allocation.reservation_count}</p>
                </div>
                <p className="mt-3 text-xs text-violet-200">
                  {t('fleetOps.costCenters.maintenanceCost', 'Maintenance cost')}: {formatMinorUnits(allocation.cost_minor, allocation.currency)}
                </p>
                <div>
                  <p className="text-[var(--text-muted)]">{t('fleetOps.costCenters.openOrders', 'Open orders')}</p>
                  <p className="font-semibold">{allocation.open_work_order_count}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
