import { useTranslation } from 'react-i18next';
import {
  useUpdateFleetReservation,
  type FleetReservation,
  type FleetReservationInput,
} from '@/api/hooks/useFleetOps';
import { ConfirmDialog } from '@/components/ui';
import { MutationErrorDialog } from './MutationErrorDialog';

interface CancelReservationDialogProps {
  item: FleetReservation;
  onClose: () => void;
  onCancelled: () => void;
  onRefresh: () => void;
}

function cancelledInput(item: FleetReservation): FleetReservationInput {
  return {
    vehicle_id: item.vehicle_id,
    driver_id: item.driver_id,
    cost_center_id: item.cost_center_id,
    title: item.title,
    purpose: item.purpose,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    status: 'cancelled',
  };
}

export function CancelReservationDialog({
  item,
  onClose,
  onCancelled,
  onRefresh,
}: CancelReservationDialogProps) {
  const { t } = useTranslation();
  const mutation = useUpdateFleetReservation();
  const close = () => {
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
        open={!mutation.isError}
        title={t('fleetOps.reservations.cancelTitle', 'Cancel reservation?')}
        message={t('fleetOps.reservations.cancelMessage', 'Cancel “{{name}}”? Its vehicle and driver time will become available.', { name: item.title })}
        confirmLabel={t('fleetOps.reservations.cancelAction', 'Cancel reservation')}
        cancelLabel={t('common.keep', 'Keep reservation')}
        variant="warning"
        loading={mutation.isPending}
        onCancel={close}
        onConfirm={() => mutation.mutate(
          { id: item.id, version: item.version, input: cancelledInput(item) },
          { onSuccess: onCancelled },
        )}
      />
      <MutationErrorDialog
        error={mutation.error}
        resourceName={t('fleetOps.delete.reservation', 'reservation')}
        onClose={() => mutation.reset()}
        onRefresh={refresh}
      />
    </>
  );
}
