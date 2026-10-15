import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button, Text, StatusPill } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type {
  FleetCostCenter,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { costCenterAllocations, formatMinorUnits } from '../helpers';
import type { DataState } from '@/api/dataState';

interface CostCenterAllocationProps {
  costCenters: FleetCostCenter[];
  reservations: FleetReservation[];
  workOrders: FleetWorkOrder[];
  loading: boolean;
  source?: DataState<unknown>;
  pendingContent?: ReactNode;
  dependencies?: {
    reservations: DataState<unknown>;
    workOrders: DataState<unknown>;
  };
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
  source,
  pendingContent,
  dependencies,
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
    <LayoutCard title={t('fleetOps.costCenters.title', 'Cost-center allocation')} actions={
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
      }>
      {dependencies && Object.entries(dependencies).map(([key, state]) => {
        if (state.hasData) return null;
        const label = key === 'reservations'
          ? t('fleetOps.reservations.resource', 'Reservations')
          : t('fleetOps.workOrders.resource', 'Work orders');
        return state.fatalError ? (
          <QueryError key={key} error={state.fatalError} onRetry={() => state.retry?.()} resourceName={label} />
        ) : (
          <div key={key} role="status">
            <Text as="p" variant="bodySm" color="muted">
              {label}: {state.isRefreshBlocked
                ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
                : t('fleetOps.brief.source.initial', 'Awaiting source')}
            </Text>
            {state.isRefreshBlocked ? <Button variant="ghost" onClick={() => state.retry?.()}>{t('common.retry', 'Retry')}</Button> : null}
          </div>
        );
      })}
      {source?.hasData !== true && error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.costCenters.resource', 'Cost centers')} />
      ) : source && !source.hasData ? (
        pendingContent
      ) : !source && loading ? <Skeleton lines={5} /> : allocations.length === 0 ? (
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
            <div key={allocation.cost_center.id} className="min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Text as="p" weight="semibold" className="break-words">{allocation.cost_center.name}</Text>
                  <Text as="p" variant="caption">{allocation.cost_center.code}</Text>
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
                  <Text as="p" variant="caption">{t('fleetOps.costCenters.bookings', 'Bookings')}</Text>
                  <Text as="p" weight="semibold">{dependencies && !dependencies.reservations.hasData ? '—' : allocation.reservation_count}</Text>
                </div>
                <Text as="p" variant="caption" className="mt-3">
                  {t('fleetOps.costCenters.maintenanceCost', 'Maintenance cost')}: {dependencies && !dependencies.workOrders.hasData ? '—' : formatMinorUnits(allocation.cost_minor, allocation.currency)}
                  {(!dependencies || dependencies.workOrders.hasData) && (
                    <>
                      {' · '}{t('fleetOps.workOrders.resource', 'Work orders')}: {allocation.qualifying_cost_count}/{allocation.work_order_count}
                      {allocation.cost_state === 'partial'
                        ? <> · {t('fleetOps.brief.source.partial', 'Partial source data')}</>
                        : null}
                    </>
                  )}
                </Text>
                <div>
                  <Text as="p" variant="caption">{t('fleetOps.costCenters.openOrders', 'Open orders')}</Text>
                  <Text as="p" weight="semibold">{dependencies && !dependencies.workOrders.hasData ? '—' : allocation.open_work_order_count}</Text>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </LayoutCard>
  );
}
