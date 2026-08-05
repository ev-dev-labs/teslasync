import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetChargingPolicy,
  useUpdateFleetChargingPolicy,
  type FleetChargingPolicy,
} from '@/api/hooks/useFleetOps';
import { Button, Input, Modal, Select, Toggle } from '@/components/ui';
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
  const [vehicleId, setVehicleId] = useState(item?.vehicle_id.toString() ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [targetSoc, setTargetSoc] = useState(item?.target_soc_pct.toString() ?? '80');
  const [maxPowerW, setMaxPowerW] = useState(item?.max_power_w?.toString() ?? '');
  const [priority, setPriority] = useState(item?.priority.toString() ?? '100');
  const [effectiveFrom, setEffectiveFrom] = useState(toLocalDateTime(item?.effective_from ?? new Date().toISOString()));
  const [effectiveTo, setEffectiveTo] = useState(toLocalDateTime(item?.effective_to));
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [windows, setWindows] = useState<EditableChargingWindow[]>(
    item?.windows.map((window) => ({ ...window, key: `window-${window.id}` }))
      ?? [{ key: 'new-0', day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
  );
  const [validation, setValidation] = useState<string | null>(null);
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = toISOStringOrNull(effectiveFrom);
    const end = toISOStringOrNull(effectiveTo);
    const soc = Number(targetSoc);
    const power = maxPowerW.trim() ? Number(maxPowerW) : null;
    const rank = Number(priority);
    if (
      !vehicleId || name.trim().length < 1 || name.trim().length > 120
      || !Number.isInteger(soc) || soc < 1 || soc > 100
      || (power != null && (!Number.isInteger(power) || power <= 0))
      || !Number.isInteger(rank) || rank < 0 || rank > 1000
      || !start || (end && new Date(end) <= new Date(start))
      || !chargingWindowsAreValid(windows)
    ) {
      setValidation(t('fleetOps.policyDialog.validation', 'Check the vehicle, 1–100% target, power, priority, effective period, and non-overlapping windows.'));
      return;
    }
    setValidation(null);
    const input = {
      vehicle_id: Number(vehicleId),
      name: name.trim(),
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
        onClose={onClose}
        title={item ? t('fleetOps.policyDialog.editTitle', 'Edit charging policy') : t('fleetOps.policyDialog.createTitle', 'Add charging policy')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('fleetOps.policies.vehicle', 'Vehicle')}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              placeholder={t('fleetOps.policyDialog.chooseVehicle', 'Choose vehicle')}
              options={vehicles.map((vehicle) => ({
                value: vehicle.id.toString(),
                label: vehicle.display_name ?? vehicle.vin ?? `${vehicle.id}`,
              }))}
              required
            />
            <Input label={t('fleetOps.policyDialog.name', 'Policy name')} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required />
            <Input label={t('fleetOps.policies.targetSoc', 'Target SoC')} type="number" min={1} max={100} step={1} suffix="%" value={targetSoc} onChange={(event) => setTargetSoc(event.target.value)} required />
            <Input
              label={t('fleetOps.policies.maxPower', 'Max power (W)')}
              type="number"
              min={1}
              step={1}
              value={maxPowerW}
              onChange={(event) => setMaxPowerW(event.target.value)}
              hint={maxPowerW && Number(maxPowerW) > 0 ? formatPower(Number(maxPowerW)) : t('fleetOps.policyDialog.powerHint', 'Optional SI-canonical power limit in watts.')}
            />
            <Input label={t('fleetOps.policies.priority', 'Priority')} type="number" min={0} max={1000} step={1} value={priority} onChange={(event) => setPriority(event.target.value)} required />
            <Toggle checked={enabled} onChange={setEnabled} label={t('fleetOps.policies.enabled', 'Enabled')} />
            <Input label={t('fleetOps.policyDialog.effectiveFrom', 'Effective from')} type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required />
            <Input label={t('fleetOps.policyDialog.effectiveTo', 'Effective to')} type="datetime-local" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} hint={t('fleetOps.policyDialog.noEnd', 'Leave blank for no end date.')} />
          </div>
          <ChargingWindowsEditor value={windows} onChange={setWindows} />
          {validation && <p role="alert" className="text-sm text-rose-300">{validation}</p>}
          <div className="flex justify-between gap-2">
            <div>{item && <Button type="button" variant="danger" onClick={() => onDelete(item)}>{t('common.delete', 'Delete')}</Button>}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
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
    </>
  );
}
