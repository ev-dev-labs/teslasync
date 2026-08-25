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
import { Button, ConfirmDialog, Input, Modal, Select, Textarea } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
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
  const [initialValues] = useState(() => ({
    vehicleId: item?.vehicle_id.toString() ?? '',
    costCenterId: item?.cost_center_id?.toString() ?? '',
    title: item?.title ?? '',
    description: item?.description ?? '',
    status: item?.status ?? 'open' as WorkOrderStatus,
    severity: item?.severity ?? 'medium' as WorkOrderSeverity,
    dueDistance: item?.due_odometer_m == null
      ? ''
      : convertDistanceFromSI(item.due_odometer_m, unitPrefs.distance).toString(),
    dueAt: toLocalDateTime(item?.due_at),
    scheduledStart: toLocalDateTime(item?.scheduled_start_at),
    scheduledEnd: toLocalDateTime(item?.scheduled_end_at),
    costMinor: item?.cost_minor?.toString() ?? '',
    currency: item?.currency ?? '',
  }));
  const [vehicleId, setVehicleId] = useState(initialValues.vehicleId);
  const [costCenterId, setCostCenterId] = useState(initialValues.costCenterId);
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [status, setStatus] = useState<WorkOrderStatus>(initialValues.status);
  const [severity, setSeverity] = useState<WorkOrderSeverity>(initialValues.severity);
  const [dueDistance, setDueDistance] = useState(initialValues.dueDistance);
  const [dueAt, setDueAt] = useState(initialValues.dueAt);
  const [scheduledStart, setScheduledStart] = useState(initialValues.scheduledStart);
  const [scheduledEnd, setScheduledEnd] = useState(initialValues.scheduledEnd);
  const [costMinor, setCostMinor] = useState(initialValues.costMinor);
  const [currency, setCurrency] = useState(initialValues.currency);
  const [errors, setErrors] = useState<Partial<Record<
    | 'vehicleId'
    | 'title'
    | 'description'
    | 'dueDistance'
    | 'dueAt'
    | 'scheduledStart'
    | 'scheduledEnd'
    | 'costMinor'
    | 'currency',
    string
  >>>({});
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const isDirty = vehicleId !== initialValues.vehicleId
    || costCenterId !== initialValues.costCenterId
    || title !== initialValues.title
    || description !== initialValues.description
    || status !== initialValues.status
    || severity !== initialValues.severity
    || dueDistance !== initialValues.dueDistance
    || dueAt !== initialValues.dueAt
    || scheduledStart !== initialValues.scheduledStart
    || scheduledEnd !== initialValues.scheduledEnd
    || costMinor !== initialValues.costMinor
    || currency !== initialValues.currency;
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.workOrderDialog.unsaved',
      'You have unsaved work-order changes. Discard them?',
      ),
    },
  );
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
    const due = toISOStringOrNull(dueAt);
    const start = toISOStringOrNull(scheduledStart);
    const end = toISOStringOrNull(scheduledEnd);
    const normalizedCurrency = currency.trim().toUpperCase();
    const nextErrors: typeof errors = {};
    const normalizedTitle = title.trim();
    if (!vehicleId) nextErrors.vehicleId = t('fleetOps.workOrderDialog.vehicleRequired', 'Choose a vehicle.');
    if (!normalizedTitle) {
      nextErrors.title = t('fleetOps.workOrderDialog.titleRequired', 'Enter a work-order title.');
    } else if (normalizedTitle.length > 160) {
      nextErrors.title = t('fleetOps.workOrderDialog.titleLimit', 'Use 160 characters or fewer.');
    }
    if (description.length > 2000) {
      nextErrors.description = t('fleetOps.workOrderDialog.descriptionLimit', 'Use 2,000 characters or fewer.');
    }
    if (dueDistance.trim() && distance == null) {
      nextErrors.dueDistance = t('fleetOps.workOrderDialog.distanceInvalid', 'Enter a non-negative distance.');
    }
    if (dueAt && !due) {
      nextErrors.dueAt = t('fleetOps.workOrderDialog.dueAtInvalid', 'Enter a valid due date and time.');
    }
    if (scheduledStart && !start) {
      nextErrors.scheduledStart = t('fleetOps.workOrderDialog.startInvalid', 'Enter a valid downtime start.');
    }
    if (scheduledEnd && !end) {
      nextErrors.scheduledEnd = t('fleetOps.workOrderDialog.endInvalid', 'Enter a valid downtime end.');
    } else if (end && (!start || new Date(end) <= new Date(start))) {
      nextErrors.scheduledEnd = t(
        'fleetOps.workOrderDialog.endAfterStart',
        'Downtime end must be after its start.',
      );
    }
    if (costMinor.trim() && minor == null) {
      nextErrors.costMinor = t('fleetOps.workOrderDialog.costInvalid', 'Enter a non-negative whole number.');
    }
    if (costMinor.trim() && !normalizedCurrency) {
      nextErrors.currency = t('fleetOps.workOrderDialog.currencyRequired', 'Enter the cost currency.');
    }
    if (!costMinor.trim() && normalizedCurrency) {
      nextErrors.costMinor = t('fleetOps.workOrderDialog.costRequired', 'Enter the cost amount.');
    }
    if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      nextErrors.currency = t('fleetOps.workOrderDialog.currencyInvalid', 'Use a three-letter ISO currency code.');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const input = {
      vehicle_id: Number(vehicleId),
      cost_center_id: costCenterId ? Number(costCenterId) : null,
      title: normalizedTitle,
      description: description.trim() || null,
      status,
      severity,
      due_odometer_m: distance == null ? null : convertDistanceToSI(distance, unitPrefs.distance),
      due_at: due,
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
      <Modal open onClose={requestClose} title={item ? t('fleetOps.workOrderDialog.editTitle', 'Edit work order') : t('fleetOps.workOrderDialog.createTitle', 'Add work order')} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t('fleetOps.policies.vehicle', 'Vehicle')} value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setErrors((current) => ({ ...current, vehicleId: undefined })); }} error={errors.vehicleId} placeholder={t('fleetOps.workOrderDialog.chooseVehicle', 'Choose vehicle')} options={vehicles.map((vehicle) => ({ value: vehicle.id.toString(), label: vehicle.display_name ?? vehicle.vin ?? `${vehicle.id}` }))} required />
            <Select label={t('fleetOps.workOrderDialog.costCenter', 'Cost center')} value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} placeholder={t('fleetOps.workOrderDialog.noCostCenter', 'No cost center')} options={costCenters.map((center) => ({ value: center.id.toString(), label: `${center.code} · ${center.name}`, disabled: !center.active && center.id !== item?.cost_center_id }))} />
            <Input label={t('fleetOps.workOrderDialog.title', 'Title')} value={title} maxLength={160} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: undefined })); }} error={errors.title} required />
            <Select label={t('fleetOps.workOrderDialog.status', 'Status')} value={status} onChange={(event) => setStatus(event.target.value as WorkOrderStatus)} options={statusOptions} />
            <Select label={t('fleetOps.workOrderDialog.severity', 'Severity')} value={severity} onChange={(event) => setSeverity(event.target.value as WorkOrderSeverity)} options={(['low', 'medium', 'high', 'critical'] as WorkOrderSeverity[]).map((value) => ({ value, label: t(`fleetOps.workOrders.${value}`, value) }))} />
            <Input label={t('fleetOps.workOrderDialog.dueDistance', 'Due odometer ({{unit}})', { unit: unitPrefs.distance })} type="number" min={0} step="any" value={dueDistance} onChange={(event) => { setDueDistance(event.target.value); setErrors((current) => ({ ...current, dueDistance: undefined })); }} error={errors.dueDistance} />
            <Input label={t('fleetOps.workOrderDialog.dueAt', 'Due at')} type="datetime-local" value={dueAt} onChange={(event) => { setDueAt(event.target.value); setErrors((current) => ({ ...current, dueAt: undefined })); }} error={errors.dueAt} />
            <Input label={t('fleetOps.workOrderDialog.scheduledStart', 'Downtime starts')} type="datetime-local" value={scheduledStart} onChange={(event) => { setScheduledStart(event.target.value); setErrors((current) => ({ ...current, scheduledStart: undefined, scheduledEnd: undefined })); }} error={errors.scheduledStart} />
            <Input label={t('fleetOps.workOrderDialog.scheduledEnd', 'Downtime ends')} type="datetime-local" value={scheduledEnd} onChange={(event) => { setScheduledEnd(event.target.value); setErrors((current) => ({ ...current, scheduledEnd: undefined })); }} error={errors.scheduledEnd} />
            <Input
              label={t('fleetOps.workOrderDialog.costMinor', 'Cost (minor currency units)')}
              type="number"
              min={0}
              step={1}
              value={costMinor}
              onChange={(event) => {
                setCostMinor(event.target.value);
                setErrors((current) => ({ ...current, costMinor: undefined, currency: undefined }));
              }}
              error={errors.costMinor}
              hint={t(
                'fleetOps.workOrderDialog.costMinorHint',
                'Enter the smallest currency unit; for USD, 12500 represents $125.00.',
              )}
            />
            <Input label={t('fleetOps.workOrderDialog.currency', 'Currency')} value={currency} maxLength={3} placeholder="USD" onChange={(event) => { setCurrency(event.target.value); setErrors((current) => ({ ...current, costMinor: undefined, currency: undefined })); }} error={errors.currency} />
          </div>
          <Textarea label={t('fleetOps.workOrderDialog.description', 'Description')} value={description} maxLength={2000} rows={3} onChange={(event) => { setDescription(event.target.value); setErrors((current) => ({ ...current, description: undefined })); }} error={errors.description} />
          <div className="flex justify-between gap-2">
            <div>{item && <Button type="button" variant="danger" onClick={() => onDelete(item)}>{t('common.delete', 'Delete')}</Button>}</div>
            <div className="flex gap-2"><Button type="button" variant="ghost" onClick={requestClose}>{t('common.cancel', 'Cancel')}</Button><Button type="submit" loading={pending}>{t('common.save', 'Save')}</Button></div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog error={error} resourceName={t('fleetOps.delete.workOrder', 'work order')} onClose={resetError} onRefresh={() => { resetError(); onRefresh(); onClose(); }} />
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  );
}
