import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetReservation,
  useUpdateFleetReservation,
  type FleetAssignment,
  type FleetCostCenter,
  type FleetReservation,
} from '@/api/hooks/useFleetOps';
import { Button, ConfirmDialog, Modal } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
import { MutationErrorDialog } from './MutationErrorDialog';
import {
  ReservationFields,
  type ReservationFieldErrors,
  type ReservationFormState,
} from './ReservationFields';
import { toISOStringOrNull, toLocalDateTime } from './formUtils';
import type { VehicleChoice } from './editorTypes';

interface ReservationDialogProps {
  item: FleetReservation | null;
  vehicles: VehicleChoice[];
  assignments: FleetAssignment[];
  costCenters: FleetCostCenter[];
  onClose: () => void;
  onSaved: () => void;
  onCancel: (item: FleetReservation) => void;
  onDelete: (item: FleetReservation) => void;
  onRefresh: () => void;
}

export function ReservationDialog({
  item,
  vehicles,
  assignments,
  costCenters,
  onClose,
  onSaved,
  onCancel,
  onDelete,
  onRefresh,
}: ReservationDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateFleetReservation();
  const updateMutation = useUpdateFleetReservation();
  const [initialForm] = useState<ReservationFormState>(() => ({
    title: item?.title ?? '',
    purpose: item?.purpose ?? '',
    vehicleId: item?.vehicle_id.toString() ?? '',
    driverId: item?.driver_id?.toString() ?? '',
    costCenterId: item?.cost_center_id?.toString() ?? '',
    startsAt: toLocalDateTime(item?.starts_at),
    endsAt: toLocalDateTime(item?.ends_at),
    status: item?.status ?? 'requested',
  }));
  const [form, setForm] = useState<ReservationFormState>(initialForm);
  const [errors, setErrors] = useState<ReservationFieldErrors>({});
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.reservationDialog.unsaved',
      'You have unsaved reservation changes. Discard them?',
      ),
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(form.startsAt);
    const end = toISOStringOrNull(form.endsAt);
    const driverIsAssigned = !form.driverId || Boolean(start && end && assignments.some((assignment) => (
      assignment.driver_id === Number(form.driverId)
      && assignment.vehicle_id === Number(form.vehicleId)
      && new Date(assignment.starts_at) <= new Date(start)
      && (!assignment.ends_at || new Date(assignment.ends_at) >= new Date(end))
    )));
    const nextErrors: ReservationFieldErrors = {};
    const title = form.title.trim();
    if (!title) {
      nextErrors.title = t('fleetOps.reservationDialog.nameRequired', 'Enter a reservation name.');
    } else if (title.length > 160) {
      nextErrors.title = t('fleetOps.reservationDialog.nameLimit', 'Use 160 characters or fewer.');
    }
    if (form.purpose.length > 500) {
      nextErrors.purpose = t('fleetOps.reservationDialog.purposeLimit', 'Use 500 characters or fewer.');
    }
    if (!form.vehicleId) {
      nextErrors.vehicleId = t('fleetOps.reservationDialog.vehicleRequired', 'Choose a vehicle.');
    }
    if (!start) {
      nextErrors.startsAt = t('fleetOps.reservationDialog.startRequired', 'Enter a valid start time.');
    }
    if (!end) {
      nextErrors.endsAt = t('fleetOps.reservationDialog.endRequired', 'Enter a valid end time.');
    } else if (start && new Date(end) <= new Date(start)) {
      nextErrors.endsAt = t('fleetOps.reservationDialog.endAfterStart', 'End time must be after the start time.');
    }
    if (!driverIsAssigned) {
      nextErrors.driverId = t(
        'fleetOps.reservationDialog.driverUnavailable',
        'Choose a driver assigned to this vehicle for the full reservation.',
      );
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !start || !end) {
      return;
    }
    const input = {
      vehicle_id: Number(form.vehicleId),
      driver_id: form.driverId ? Number(form.driverId) : null,
      cost_center_id: form.costCenterId ? Number(form.costCenterId) : null,
      title: form.title.trim(),
      purpose: form.purpose.trim() || null,
      starts_at: start,
      ends_at: end,
      status: form.status,
    };
    if (item) {
      updateMutation.mutate(
        { id: item.id, version: item.version, input },
        { onSuccess: onSaved },
      );
    } else {
      createMutation.mutate(input, { onSuccess: onSaved });
    }
  };
  const resetError = () => {
    createMutation.reset();
    updateMutation.reset();
  };

  return (
    <>
      <Modal
        open
        onClose={requestClose}
        title={item
          ? t('fleetOps.reservationDialog.editTitle', 'Edit reservation')
          : t('fleetOps.reservationDialog.title', 'Create reservation')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <ReservationFields
            item={item}
            value={form}
            errors={errors}
            onChange={(patch) => {
              setForm((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };
                Object.keys(patch).forEach((key) => {
                  delete next[key as keyof ReservationFieldErrors];
                });
                if ('vehicleId' in patch) delete next.driverId;
                if ('startsAt' in patch) delete next.endsAt;
                return next;
              });
            }}
            vehicles={vehicles}
            assignments={assignments}
            costCenters={costCenters}
          />
          <div className="flex justify-between gap-2">
            <div className="flex gap-2">
              {item && (
                <Button type="button" variant="danger" onClick={() => onDelete(item)}>
                  {t('common.delete', 'Delete')}
                </Button>
              )}
              {item && (item.status === 'requested' || item.status === 'confirmed') && (
                <Button type="button" variant="outline" onClick={() => onCancel(item)}>
                  {t('fleetOps.reservations.cancelAction', 'Cancel reservation')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestClose}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" loading={pending}>
                {item ? t('common.save', 'Save') : t('fleetOps.reservationDialog.create', 'Create reservation')}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog
        error={error}
        resourceName={t('fleetOps.delete.reservation', 'reservation')}
        onClose={resetError}
        onRefresh={() => {
          resetError();
          onRefresh();
          onClose();
        }}
      />
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  );
}
