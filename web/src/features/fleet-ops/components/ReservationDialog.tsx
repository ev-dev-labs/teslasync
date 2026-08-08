import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetReservation,
  useUpdateFleetReservation,
  type FleetAssignment,
  type FleetCostCenter,
  type FleetReservation,
} from '@/api/hooks/useFleetOps';
import { Button, Modal } from '@/components/ui';
import { MutationErrorDialog } from './MutationErrorDialog';
import { ReservationFields, type ReservationFormState } from './ReservationFields';
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
  const [form, setForm] = useState<ReservationFormState>({
    title: item?.title ?? '',
    purpose: item?.purpose ?? '',
    vehicleId: item?.vehicle_id.toString() ?? '',
    driverId: item?.driver_id?.toString() ?? '',
    costCenterId: item?.cost_center_id?.toString() ?? '',
    startsAt: toLocalDateTime(item?.starts_at),
    endsAt: toLocalDateTime(item?.ends_at),
    status: item?.status ?? 'requested',
  });
  const [validation, setValidation] = useState<string | null>(null);
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(form.startsAt);
    const end = toISOStringOrNull(form.endsAt);
    const driverIsAssigned = !form.driverId || (start && end && assignments.some((assignment) => (
      assignment.driver_id === Number(form.driverId)
      && assignment.vehicle_id === Number(form.vehicleId)
      && new Date(assignment.starts_at) <= new Date(start)
      && (!assignment.ends_at || new Date(assignment.ends_at) >= new Date(end))
    )));
    if (
      !form.vehicleId || form.title.trim().length < 1 || form.title.trim().length > 160
      || form.purpose.length > 500 || !start || !end || new Date(end) <= new Date(start)
      || !driverIsAssigned
    ) {
      setValidation(t('fleetOps.reservationDialog.validation', 'Enter a name, vehicle, valid period, and a driver assigned for the full reservation.'));
      return;
    }
    setValidation(null);
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
        onClose={onClose}
        title={item
          ? t('fleetOps.reservationDialog.editTitle', 'Edit reservation')
          : t('fleetOps.reservationDialog.title', 'Create reservation')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <ReservationFields
            item={item}
            value={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            vehicles={vehicles}
            assignments={assignments}
            costCenters={costCenters}
          />
          {validation && <p role="alert" className="text-sm text-rose-300">{validation}</p>}
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
              <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
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
    </>
  );
}
