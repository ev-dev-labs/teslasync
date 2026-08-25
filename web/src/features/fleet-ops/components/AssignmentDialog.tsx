import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetAssignment,
  useUpdateFleetAssignment,
  type FleetAssignment,
  type FleetDriver,
} from '@/api/hooks/useFleetOps';
import { Button, ConfirmDialog, Input, Modal, Select, Textarea } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
import { MutationErrorDialog } from './MutationErrorDialog';
import { toISOStringOrNull, toLocalDateTime } from './formUtils';
import type { VehicleChoice } from './editorTypes';

interface AssignmentDialogProps {
  item: FleetAssignment | null;
  drivers: FleetDriver[];
  vehicles: VehicleChoice[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: FleetAssignment) => void;
  onRefresh: () => void;
}

export function AssignmentDialog({
  item,
  drivers,
  vehicles,
  onClose,
  onSaved,
  onDelete,
  onRefresh,
}: AssignmentDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateFleetAssignment();
  const updateMutation = useUpdateFleetAssignment();
  const [initialValues] = useState(() => ({
    vehicleId: item?.vehicle_id.toString() ?? '',
    driverId: item?.driver_id.toString() ?? '',
    startsAt: toLocalDateTime(item?.starts_at ?? new Date().toISOString()),
    endsAt: toLocalDateTime(item?.ends_at),
    notes: item?.notes ?? '',
  }));
  const [vehicleId, setVehicleId] = useState(initialValues.vehicleId);
  const [driverId, setDriverId] = useState(initialValues.driverId);
  const [startsAt, setStartsAt] = useState(initialValues.startsAt);
  const [endsAt, setEndsAt] = useState(initialValues.endsAt);
  const [notes, setNotes] = useState(initialValues.notes);
  const [errors, setErrors] = useState<Partial<Record<
    'vehicleId' | 'driverId' | 'startsAt' | 'endsAt' | 'notes',
    string
  >>>({});
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const isDirty = vehicleId !== initialValues.vehicleId
    || driverId !== initialValues.driverId
    || startsAt !== initialValues.startsAt
    || endsAt !== initialValues.endsAt
    || notes !== initialValues.notes;
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.assignmentDialog.unsaved',
      'You have unsaved assignment changes. Discard them?',
      ),
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(startsAt);
    const end = toISOStringOrNull(endsAt);
    const nextErrors: typeof errors = {};
    if (!vehicleId) nextErrors.vehicleId = t('fleetOps.assignmentDialog.vehicleRequired', 'Choose a vehicle.');
    if (!driverId) nextErrors.driverId = t('fleetOps.assignmentDialog.driverRequired', 'Choose a driver.');
    if (!start) nextErrors.startsAt = t('fleetOps.assignmentDialog.startRequired', 'Enter a valid start time.');
    if (endsAt && !end) {
      nextErrors.endsAt = t('fleetOps.assignmentDialog.endInvalid', 'Enter a valid end time.');
    } else if (end && start && new Date(end) <= new Date(start)) {
      nextErrors.endsAt = t('fleetOps.assignmentDialog.endAfterStart', 'End time must be after the start time.');
    }
    if (notes.length > 500) {
      nextErrors.notes = t('fleetOps.assignmentDialog.notesLimit', 'Use 500 characters or fewer.');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !start) {
      return;
    }
    const input = {
      vehicle_id: Number(vehicleId),
      driver_id: Number(driverId),
      starts_at: start,
      ends_at: end,
      notes: notes.trim() || null,
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
          ? t('fleetOps.assignmentDialog.editTitle', 'Edit assignment')
          : t('fleetOps.assignmentDialog.createTitle', 'Add assignment')}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('fleetOps.assignments.vehicle', 'Vehicle')}
              value={vehicleId}
              onChange={(event) => {
                setVehicleId(event.target.value);
                setErrors((current) => ({ ...current, vehicleId: undefined }));
              }}
              error={errors.vehicleId}
              placeholder={t('fleetOps.assignmentDialog.chooseVehicle', 'Choose vehicle')}
              options={vehicles.map((vehicle) => ({
                value: vehicle.id.toString(),
                label: vehicle.display_name ?? vehicle.vin ?? `${vehicle.id}`,
              }))}
              required
            />
            <Select
              label={t('fleetOps.assignments.driver', 'Driver')}
              value={driverId}
              onChange={(event) => {
                setDriverId(event.target.value);
                setErrors((current) => ({ ...current, driverId: undefined }));
              }}
              error={errors.driverId}
              placeholder={t('fleetOps.assignmentDialog.chooseDriver', 'Choose driver')}
              options={drivers.map((driver) => ({
                value: driver.id.toString(),
                label: driver.display_name,
                disabled: driver.status !== 'active' && driver.id !== item?.driver_id,
              }))}
              required
            />
            <Input
              label={t('fleetOps.assignments.starts', 'Starts')}
              type="datetime-local"
              value={startsAt}
              onChange={(event) => {
                setStartsAt(event.target.value);
                setErrors((current) => ({ ...current, startsAt: undefined, endsAt: undefined }));
              }}
              error={errors.startsAt}
              required
            />
            <Input
              label={t('fleetOps.assignments.ends', 'Ends')}
              type="datetime-local"
              value={endsAt}
              onChange={(event) => {
                setEndsAt(event.target.value);
                setErrors((current) => ({ ...current, endsAt: undefined }));
              }}
              error={errors.endsAt}
              hint={t('fleetOps.assignmentDialog.ongoingHint', 'Leave blank for an ongoing assignment.')}
            />
          </div>
          <Textarea
            label={t('fleetOps.assignmentDialog.notes', 'Notes')}
            value={notes}
            maxLength={500}
            rows={3}
            onChange={(event) => {
              setNotes(event.target.value);
              setErrors((current) => ({ ...current, notes: undefined }));
            }}
            error={errors.notes}
          />
          <div className="flex justify-between gap-2">
            <div>
              {item && (
                <Button type="button" variant="danger" onClick={() => onDelete(item)}>
                  {t('common.delete', 'Delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestClose}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" loading={pending}>{t('common.save', 'Save')}</Button>
            </div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog
        error={error}
        resourceName={t('fleetOps.delete.assignment', 'assignment')}
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
