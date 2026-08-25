import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetChargingPolicy,
  useUpdateFleetChargingPolicy,
  type FleetChargingPolicy,
} from '@/api/hooks/useFleetOps';
import { Button, ConfirmDialog, Input, Modal, Select, Toggle } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
import { useUnits } from '@/hooks/useUnits';
import { ChargingWindowsEditor } from './ChargingWindowsEditor';
import { chargingWindowsAreValid, type EditableChargingWindow } from './chargingWindowUtils';
import { MutationErrorDialog } from './MutationErrorDialog';
import { toISOStringOrNull, toLocalDateTime } from './formUtils';
import type { VehicleChoice } from './editorTypes';

interface ChargingPolicyDialogProps {
  item: FleetChargingPolicy | null;
  vehicles: VehicleChoice[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: FleetChargingPolicy) => void;
  onRefresh: () => void;
}

export function ChargingPolicyDialog({
  item,
  vehicles,
  onClose,
  onSaved,
  onDelete,
  onRefresh,
}: ChargingPolicyDialogProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const createMutation = useCreateFleetChargingPolicy();
  const updateMutation = useUpdateFleetChargingPolicy();
  const [initialValues] = useState(() => ({
    vehicleId: item?.vehicle_id.toString() ?? '',
    name: item?.name ?? '',
    targetSoc: item?.target_soc_pct.toString() ?? '80',
    maxPowerW: item?.max_power_w?.toString() ?? '',
    priority: item?.priority.toString() ?? '100',
    effectiveFrom: toLocalDateTime(item?.effective_from ?? new Date().toISOString()),
    effectiveTo: toLocalDateTime(item?.effective_to),
    enabled: item?.enabled ?? true,
    windows: item?.windows.map((window) => ({ ...window, key: `window-${window.id}` }))
      ?? [{ key: 'new-0', day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
  }));
  const [vehicleId, setVehicleId] = useState(initialValues.vehicleId);
  const [name, setName] = useState(initialValues.name);
  const [targetSoc, setTargetSoc] = useState(initialValues.targetSoc);
  const [maxPowerW, setMaxPowerW] = useState(initialValues.maxPowerW);
  const [priority, setPriority] = useState(initialValues.priority);
  const [effectiveFrom, setEffectiveFrom] = useState(initialValues.effectiveFrom);
  const [effectiveTo, setEffectiveTo] = useState(initialValues.effectiveTo);
  const [enabled, setEnabled] = useState(initialValues.enabled);
  const [windows, setWindows] = useState<EditableChargingWindow[]>(initialValues.windows);
  const [errors, setErrors] = useState<Partial<Record<
    | 'vehicleId'
    | 'name'
    | 'targetSoc'
    | 'maxPowerW'
    | 'priority'
    | 'effectiveFrom'
    | 'effectiveTo'
    | 'windows',
    string
  >>>({});
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const isDirty = vehicleId !== initialValues.vehicleId
    || name !== initialValues.name
    || targetSoc !== initialValues.targetSoc
    || maxPowerW !== initialValues.maxPowerW
    || priority !== initialValues.priority
    || effectiveFrom !== initialValues.effectiveFrom
    || effectiveTo !== initialValues.effectiveTo
    || enabled !== initialValues.enabled
    || JSON.stringify(windows) !== JSON.stringify(initialValues.windows);
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.policyDialog.unsaved',
      'You have unsaved charging-policy changes. Discard them?',
      ),
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(effectiveFrom);
    const end = toISOStringOrNull(effectiveTo);
    const soc = Number(targetSoc);
    const power = maxPowerW.trim() ? Number(maxPowerW) : null;
    const rank = Number(priority);
    const nextErrors: typeof errors = {};
    const normalizedName = name.trim();
    if (!vehicleId) nextErrors.vehicleId = t('fleetOps.policyDialog.vehicleRequired', 'Choose a vehicle.');
    if (!normalizedName) {
      nextErrors.name = t('fleetOps.policyDialog.nameRequired', 'Enter a policy name.');
    } else if (normalizedName.length > 120) {
      nextErrors.name = t('fleetOps.policyDialog.nameLimit', 'Use 120 characters or fewer.');
    }
    if (!targetSoc.trim() || !Number.isInteger(soc) || soc < 1 || soc > 100) {
      nextErrors.targetSoc = t('fleetOps.policyDialog.targetInvalid', 'Enter a whole-number target from 1% to 100%.');
    }
    if (power != null && (!Number.isInteger(power) || power <= 0)) {
      nextErrors.maxPowerW = t('fleetOps.policyDialog.powerInvalid', 'Enter a positive whole number of watts.');
    }
    if (!priority.trim() || !Number.isInteger(rank) || rank < 0 || rank > 1000) {
      nextErrors.priority = t('fleetOps.policyDialog.priorityInvalid', 'Enter a whole-number priority from 0 to 1,000.');
    }
    if (!start) {
      nextErrors.effectiveFrom = t('fleetOps.policyDialog.startRequired', 'Enter a valid effective start.');
    }
    if (effectiveTo && !end) {
      nextErrors.effectiveTo = t('fleetOps.policyDialog.endInvalid', 'Enter a valid effective end.');
    } else if (end && start && new Date(end) <= new Date(start)) {
      nextErrors.effectiveTo = t('fleetOps.policyDialog.endAfterStart', 'Effective end must be after its start.');
    }
    if (!chargingWindowsAreValid(windows)) {
      nextErrors.windows = t(
        'fleetOps.policyDialog.windowsInvalid',
        'Add valid, non-overlapping charging windows.',
      );
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !start) {
      return;
    }
    const input = {
      vehicle_id: Number(vehicleId),
      name: normalizedName,
      target_soc_pct: soc,
      max_power_w: power,
      priority: rank,
      effective_from: start,
      effective_to: end,
      enabled,
      windows: windows.map(({ day_of_week, start_local_time, end_local_time }) => ({
        day_of_week,
        start_local_time,
        end_local_time,
      })),
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
      <Modal
        open
        onClose={requestClose}
        title={item ? t('fleetOps.policyDialog.editTitle', 'Edit charging policy') : t('fleetOps.policyDialog.createTitle', 'Add charging policy')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('fleetOps.policies.vehicle', 'Vehicle')}
              value={vehicleId}
              onChange={(event) => {
                setVehicleId(event.target.value);
                setErrors((current) => ({ ...current, vehicleId: undefined }));
              }}
              error={errors.vehicleId}
              placeholder={t('fleetOps.policyDialog.chooseVehicle', 'Choose vehicle')}
              options={vehicles.map((vehicle) => ({
                value: vehicle.id.toString(),
                label: vehicle.display_name ?? vehicle.vin ?? `${vehicle.id}`,
              }))}
              required
            />
            <Input label={t('fleetOps.policyDialog.name', 'Policy name')} value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} error={errors.name} required />
            <Input label={t('fleetOps.policies.targetSoc', 'Target SoC')} type="number" min={1} max={100} step={1} suffix="%" value={targetSoc} onChange={(event) => { setTargetSoc(event.target.value); setErrors((current) => ({ ...current, targetSoc: undefined })); }} error={errors.targetSoc} required />
            <Input
              label={t('fleetOps.policies.maxPower', 'Max power (W)')}
              type="number"
              min={1}
              step={1}
              value={maxPowerW}
              onChange={(event) => {
                setMaxPowerW(event.target.value);
                setErrors((current) => ({ ...current, maxPowerW: undefined }));
              }}
              error={errors.maxPowerW}
              hint={maxPowerW && Number(maxPowerW) > 0 ? formatPower(Number(maxPowerW)) : t('fleetOps.policyDialog.powerHint', 'Optional SI-canonical power limit in watts.')}
            />
            <Input label={t('fleetOps.policies.priority', 'Priority')} type="number" min={0} max={1000} step={1} value={priority} onChange={(event) => { setPriority(event.target.value); setErrors((current) => ({ ...current, priority: undefined })); }} error={errors.priority} required />
            <Toggle checked={enabled} onChange={setEnabled} label={t('fleetOps.policies.enabled', 'Enabled')} />
            <Input label={t('fleetOps.policyDialog.effectiveFrom', 'Effective from')} type="datetime-local" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setErrors((current) => ({ ...current, effectiveFrom: undefined, effectiveTo: undefined })); }} error={errors.effectiveFrom} required />
            <Input label={t('fleetOps.policyDialog.effectiveTo', 'Effective to')} type="datetime-local" value={effectiveTo} onChange={(event) => { setEffectiveTo(event.target.value); setErrors((current) => ({ ...current, effectiveTo: undefined })); }} error={errors.effectiveTo} hint={t('fleetOps.policyDialog.noEnd', 'Leave blank for no end date.')} />
          </div>
          <ChargingWindowsEditor
            value={windows}
            onChange={(value) => {
              setWindows(value);
              setErrors((current) => ({ ...current, windows: undefined }));
            }}
            error={errors.windows}
          />
          <div className="flex justify-between gap-2">
            <div>{item && <Button type="button" variant="danger" onClick={() => onDelete(item)}>{t('common.delete', 'Delete')}</Button>}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestClose}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" loading={pending}>{t('common.save', 'Save')}</Button>
            </div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog
        error={error}
        resourceName={t('fleetOps.delete.policy', 'charging policy')}
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
