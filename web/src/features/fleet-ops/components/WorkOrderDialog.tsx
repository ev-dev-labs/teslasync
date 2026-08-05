import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetWorkOrder,
  useUpdateFleetWorkOrder,
  type FleetCostCenter,
  type FleetWorkOrder,
  type WorkOrderSeverity,
  type WorkOrderStatus,
} from '@/api/hooks/useFleetOps';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { MutationErrorDialog } from './MutationErrorDialog';
import { optionalPositiveInteger, optionalPositiveNumber, toISOStringOrNull, toLocalDateTime } from './formUtils';
import type { VehicleChoice } from './editorTypes';

interface WorkOrderDialogProps {
  item: FleetWorkOrder | null;
  vehicles: VehicleChoice[];
  costCenters: FleetCostCenter[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: FleetWorkOrder) => void;
  onRefresh: () => void;
}

const transitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open: ['open', 'scheduled', 'in_progress', 'cancelled'],
  scheduled: ['scheduled', 'open', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export function WorkOrderDialog({
  item,
  vehicles,
  costCenters,
  onClose,
  onSaved,
  onDelete,
  onRefresh,
}: WorkOrderDialogProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const createMutation = useCreateFleetWorkOrder();
  const updateMutation = useUpdateFleetWorkOrder();
  const [vehicleId, setVehicleId] = useState(item?.vehicle_id.toString() ?? '');
  const [costCenterId, setCostCenterId] = useState(item?.cost_center_id?.toString() ?? '');
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [status, setStatus] = useState<WorkOrderStatus>(item?.status ?? 'open');
  const [severity, setSeverity] = useState<WorkOrderSeverity>(item?.severity ?? 'medium');
  const [dueDistance, setDueDistance] = useState(
    item?.due_odometer_m == null ? '' : convertDistanceFromSI(item.due_odometer_m, unitPrefs.distance).toString(),
  );
  const [dueAt, setDueAt] = useState(toLocalDateTime(item?.due_at));
  const [scheduledStart, setScheduledStart] = useState(toLocalDateTime(item?.scheduled_start_at));
  const [scheduledEnd, setScheduledEnd] = useState(toLocalDateTime(item?.scheduled_end_at));
  const [costMinor, setCostMinor] = useState(item?.cost_minor?.toString() ?? '');
  const [currency, setCurrency] = useState(item?.currency ?? '');
  const [validation, setValidation] = useState<string | null>(null);
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const statusValues = item ? transitions[item.status] : ['open', 'scheduled', 'in_progress'] as WorkOrderStatus[];
  const statusOptions = statusValues.map((value) => ({
    value,
    label: {
      open: t('fleetOps.workOrders.open', 'Open'),
      scheduled: t('fleetOps.workOrders.scheduled', 'Scheduled'),
      in_progress: t('fleetOps.workOrders.inProgress', 'In progress'),
      completed: t('fleetOps.workOrders.completed', 'Completed'),
      cancelled: t('fleetOps.workOrders.cancelled', 'Cancelled'),
    }[value],
  }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const distance = optionalPositiveNumber(dueDistance);
    const minor = optionalPositiveInteger(costMinor);
    const start = toISOStringOrNull(scheduledStart);
    const end = toISOStringOrNull(scheduledEnd);
    const normalizedCurrency = currency.trim().toUpperCase();
    if (
      !vehicleId || title.trim().length < 1 || title.trim().length > 160 || description.length > 2000
      || (dueDistance.trim() && distance == null) || (costMinor.trim() && minor == null)
      || Boolean(costMinor.trim()) !== Boolean(normalizedCurrency)
      || (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency))
      || (end && (!start || new Date(end) <= new Date(start)))
    ) {
      setValidation(t('fleetOps.workOrderDialog.validation', 'Check required fields, non-negative distance/cost, the three-letter currency, and scheduled downtime.'));
      return;
    }
    setValidation(null);
    const input = {
      vehicle_id: Number(vehicleId),
      cost_center_id: costCenterId ? Number(costCenterId) : null,
      title: title.trim(),
      description: description.trim() || null,
      status,
      severity,
      due_odometer_m: distance == null ? null : convertDistanceToSI(distance, unitPrefs.distance),
      due_at: toISOStringOrNull(dueAt),
      scheduled_start_at: start,
      scheduled_end_at: end,
      cost_minor: minor,
      currency: normalizedCurrency || null,
    };
    if (item) {
      updateMutation.mutate({ id: item.id, version: item.version, input }, { onSuccess: onSaved });
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
      <Modal open onClose={onClose} title={item ? t('fleetOps.workOrderDialog.editTitle', 'Edit work order') : t('fleetOps.workOrderDialog.createTitle', 'Add work order')} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t('fleetOps.policies.vehicle', 'Vehicle')} value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} placeholder={t('fleetOps.workOrderDialog.chooseVehicle', 'Choose vehicle')} options={vehicles.map((vehicle) => ({ value: vehicle.id.toString(), label: vehicle.display_name ?? vehicle.vin ?? `${vehicle.id}` }))} required />
            <Select label={t('fleetOps.workOrderDialog.costCenter', 'Cost center')} value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} placeholder={t('fleetOps.workOrderDialog.noCostCenter', 'No cost center')} options={costCenters.map((center) => ({ value: center.id.toString(), label: `${center.code} · ${center.name}`, disabled: !center.active && center.id !== item?.cost_center_id }))} />
            <Input label={t('fleetOps.workOrderDialog.title', 'Title')} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} required />
            <Select label={t('fleetOps.workOrderDialog.status', 'Status')} value={status} onChange={(event) => setStatus(event.target.value as WorkOrderStatus)} options={statusOptions} />
            <Select label={t('fleetOps.workOrderDialog.severity', 'Severity')} value={severity} onChange={(event) => setSeverity(event.target.value as WorkOrderSeverity)} options={(['low', 'medium', 'high', 'critical'] as WorkOrderSeverity[]).map((value) => ({ value, label: t(`fleetOps.workOrders.${value}`, value) }))} />
            <Input label={t('fleetOps.workOrderDialog.dueDistance', 'Due odometer ({{unit}})', { unit: unitPrefs.distance })} type="number" min={0} step="any" value={dueDistance} onChange={(event) => setDueDistance(event.target.value)} />
            <Input label={t('fleetOps.workOrderDialog.dueAt', 'Due at')} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            <Input label={t('fleetOps.workOrderDialog.scheduledStart', 'Downtime starts')} type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} />
            <Input label={t('fleetOps.workOrderDialog.scheduledEnd', 'Downtime ends')} type="datetime-local" value={scheduledEnd} onChange={(event) => setScheduledEnd(event.target.value)} />
            <Input label={t('fleetOps.workOrderDialog.costMinor', 'Cost (minor units)')} type="number" min={0} step={1} value={costMinor} onChange={(event) => setCostMinor(event.target.value)} />
            <Input label={t('fleetOps.workOrderDialog.currency', 'Currency')} value={currency} maxLength={3} placeholder="USD" onChange={(event) => setCurrency(event.target.value)} />
          </div>
          <Textarea label={t('fleetOps.workOrderDialog.description', 'Description')} value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} />
          {validation && <p role="alert" className="text-sm text-rose-300">{validation}</p>}
          <div className="flex justify-between gap-2">
            <div>{item && <Button type="button" variant="danger" onClick={() => onDelete(item)}>{t('common.delete', 'Delete')}</Button>}</div>
            <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button type="submit" loading={pending}>{t('common.save', 'Save')}</Button></div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog error={error} resourceName={t('fleetOps.delete.workOrder', 'work order')} onClose={resetError} onRefresh={() => { resetError(); onRefresh(); onClose(); }} />
    </>
  );
}
