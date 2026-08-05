import { useTranslation } from 'react-i18next';
import {
  useDeleteFleetAssignment,
  useDeleteFleetChargingPolicy,
  useDeleteFleetCostCenter,
  useDeleteFleetDriver,
  useDeleteFleetReservation,
  useDeleteFleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { ConfirmDialog } from '@/components/ui';
import { MutationErrorDialog } from './MutationErrorDialog';
import type { FleetDeleteTarget } from './editorTypes';

interface DeleteFleetResourceDialogProps {
  target: FleetDeleteTarget | null;
  onClose: () => void;
  onDeleted: () => void;
  onRefresh: () => void;
}

export function DeleteFleetResourceDialog({
  target,
  onClose,
  onDeleted,
  onRefresh,
}: DeleteFleetResourceDialogProps) {
  const { t } = useTranslation();
  const mutations = {
    driver: useDeleteFleetDriver(),
    assignment: useDeleteFleetAssignment(),
    cost_center: useDeleteFleetCostCenter(),
    reservation: useDeleteFleetReservation(),
    charging_policy: useDeleteFleetChargingPolicy(),
    work_order: useDeleteFleetWorkOrder(),
  };
  const mutation = target ? mutations[target.kind] : mutations.driver;
  const labels = target ? {
    driver: target.kind === 'driver' ? target.item.display_name : '',
    assignment: target.kind === 'assignment' ? `${target.item.driver_display_name} · ${target.item.vehicle_display_name}` : '',
    cost_center: target.kind === 'cost_center' ? target.item.name : '',
    reservation: target.kind === 'reservation' ? target.item.title : '',
    charging_policy: target.kind === 'charging_policy' ? target.item.name : '',
    work_order: target.kind === 'work_order' ? target.item.title : '',
  }[target.kind] : '';
  const resourceName = target ? {
    driver: t('fleetOps.delete.driver', 'driver'),
    assignment: t('fleetOps.delete.assignment', 'assignment'),
    cost_center: t('fleetOps.delete.costCenter', 'cost center'),
    reservation: t('fleetOps.delete.reservation', 'reservation'),
    charging_policy: t('fleetOps.delete.policy', 'charging policy'),
    work_order: t('fleetOps.delete.workOrder', 'work order'),
  }[target.kind] : t('fleetOps.delete.record', 'record');

  const confirm = () => {
    if (!target) return;
    mutation.mutate(
      { id: target.item.id, version: target.item.version },
      { onSuccess: onDeleted },
    );
  };
  const resetAndClose = () => {
    mutation.reset();
    onClose();
  };
  const refresh = () => {
    mutation.reset();
    onRefresh();
    onClose();
  };

  return (
    <>
      <ConfirmDialog
        open={target != null && !mutation.isError}
        title={t('fleetOps.delete.title', 'Delete {{resource}}?', { resource: resourceName })}
        message={t('fleetOps.delete.message', 'Delete “{{name}}”? This cannot be undone and may be blocked while related records are active.', { name: labels })}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={mutation.isPending}
        onConfirm={confirm}
        onCancel={resetAndClose}
      />
      <MutationErrorDialog
        error={mutation.error}
        resourceName={resourceName}
        onClose={() => mutation.reset()}
        onRefresh={refresh}
      />
    </>
  );
}
