import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetAssignment,
  useUpdateFleetAssignment,
  type FleetAssignment,
  type FleetDriver,
} from '@/api/hooks/useFleetOps';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
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
  const [vehicleId, setVehicleId] = useState(item?.vehicle_id.toString() ?? '');
  const [driverId, setDriverId] = useState(item?.driver_id.toString() ?? '');
  const [startsAt, setStartsAt] = useState(
    toLocalDateTime(item?.starts_at ?? new Date().toISOString()),
  );
  const [endsAt, setEndsAt] = useState(toLocalDateTime(item?.ends_at));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [validation, setValidation] = useState<string | null>(null);
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(startsAt);
    const end = toISOStringOrNull(endsAt);
    if (!vehicleId || !driverId || !start || (end && new Date(end) <= new Date(start)) || notes.length > 500) {
      setValidation(t('fleetOps.assignmentDialog.validation', 'Choose a driver and vehicle, and enter a valid period. Notes may use up to 500 characters.'));
      return;
    }
    setValidation(null);
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
        onClose={onClose}
        title={item
          ? t('fleetOps.assignmentDialog.editTitle', 'Edit assignment')
          : t('fleetOps.assignmentDialog.createTitle', 'Add assignment')}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('fleetOps.assignments.vehicle', 'Vehicle')}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
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
              onChange={(event) => setDriverId(event.target.value)}
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
              onChange={(event) => setStartsAt(event.target.value)}
              required
            />
            <Input
              label={t('fleetOps.assignments.ends', 'Ends')}
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              hint={t('fleetOps.assignmentDialog.ongoingHint', 'Leave blank for an ongoing assignment.')}
            />
          </div>
          <Textarea
            label={t('fleetOps.assignmentDialog.notes', 'Notes')}
            value={notes}
            maxLength={500}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
          />
          {validation && <p role="alert" className="text-sm text-rose-300">{validation}</p>}
          <div className="flex justify-between gap-2">
            <div>
              {item && (
                <Button type="button" variant="danger" onClick={() => onDelete(item)}>
                  {t('common.delete', 'Delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
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
    </>
  );
}
