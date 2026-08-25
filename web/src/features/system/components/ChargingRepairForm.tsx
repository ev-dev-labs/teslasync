import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Save, Trash2, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import {
  useCloseCharging,
  useDiscardCharging,
  useUpdateCharging,
  type RepairPatch,
  type StaleChargingSession,
} from '@/api/hooks/useDataRepair';

export interface ChargingRepairFormProps {
  session: StaleChargingSession;
  /** DOM id so the triggering row can reference this form via `aria-controls`. */
  formId: string;
  onClose: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

/** Non-empty string → keep; otherwise drop from the patch. */
function num(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `ChargingRepairForm` — inline SI editor for one stale charging session.
 *
 * Inputs are entered in SI (Wh, W) to match the `charging_sessions` columns the
 * backend `ChargingPartialAllowed` whitelist accepts; a live `useUnits()` hint
 * shows the equivalent in the operator's preferred display unit. Save patches
 * only the fields that were filled; Close stamps `ended_at`; Discard deletes.
 */
export function ChargingRepairForm({
  session,
  formId,
  onClose,
  disabled = false,
  disabledReason,
}: ChargingRepairFormProps) {
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();

  const [form, setForm] = useState({
    ended_at: '',
    total_energy_added_wh: String(session.total_energy_added_wh ?? ''),
    end_soc_pct: String(session.end_soc_pct ?? ''),
    peak_power_w: String(session.peak_power_w ?? ''),
    avg_power_w: String(session.avg_power_w ?? ''),
    cost_decimal: String(session.cost_decimal ?? ''),
  });

  const update = useUpdateCharging();
  const close = useCloseCharging();
  const discard = useDiscardCharging();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSave = () => {
    const patch: RepairPatch = {};
    if (form.ended_at.trim()) patch.ended_at = form.ended_at.trim();
    const energy = num(form.total_energy_added_wh);
    if (energy != null) patch.total_energy_added_wh = energy;
    const endSoc = num(form.end_soc_pct);
    if (endSoc != null) patch.end_soc_pct = endSoc;
    const peak = num(form.peak_power_w);
    if (peak != null) patch.peak_power_w = peak;
    const avg = num(form.avg_power_w);
    if (avg != null) patch.avg_power_w = avg;
    const cost = num(form.cost_decimal);
    if (cost != null) patch.cost_decimal = cost;
    update.mutate({ id: session.id, patch }, { onSuccess: onClose });
  };

  const energyHint = form.total_energy_added_wh.trim()
    ? formatEnergy(Number(form.total_energy_added_wh))
    : undefined;
  const peakHint = form.peak_power_w.trim() ? formatPower(Number(form.peak_power_w)) : undefined;
  const avgHint = form.avg_power_w.trim() ? formatPower(Number(form.avg_power_w)) : undefined;

  return (
    <div
      id={formId}
      role="region"
      aria-label={t('dataRepair.charging.formLabel', 'Repair charging session #{{id}}', {
        id: session.id,
      })}
      className="mt-2 space-y-4 rounded-lg bg-amber-500/[0.04] p-3 ring-1 ring-amber-400/20 sm:p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <Input
          label={t('dataRepair.field.endedAt', 'End Date/Time (ISO)')}
          value={form.ended_at}
          placeholder="2026-03-30T04:00:00Z"
          onChange={set('ended_at')}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.energyWh', 'Energy Added (Wh)')}
          type="number"
          value={form.total_energy_added_wh}
          onChange={set('total_energy_added_wh')}
          hint={energyHint}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.endSoc', 'End Battery (%)')}
          type="number"
          value={form.end_soc_pct}
          onChange={set('end_soc_pct')}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.peakPowerW', 'Peak Power (W)')}
          type="number"
          value={form.peak_power_w}
          onChange={set('peak_power_w')}
          hint={peakHint}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.avgPowerW', 'Avg Power (W)')}
          type="number"
          value={form.avg_power_w}
          onChange={set('avg_power_w')}
          hint={avgHint}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.cost', 'Cost')}
          type="number"
          value={form.cost_decimal}
          onChange={set('cost_decimal')}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={onSave}
          loading={update.isPending}
          disabled={disabled}
          title={disabledReason}
          icon={<Save className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('common.save', 'Save')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => close.mutate(session.id, { onSuccess: onClose })}
          loading={close.isPending}
          disabled={disabled}
          title={disabledReason}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('dataRepair.action.closeSession', 'Close Session')}
        </Button>
        <Button
          variant="danger"
          onClick={() => discard.mutate(session.id, { onSuccess: onClose })}
          loading={discard.isPending}
          disabled={disabled}
          title={disabledReason}
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('dataRepair.action.discard', 'Discard')}
        </Button>
        <Button
          variant="ghost"
          onClick={onClose}
          icon={<X className="h-4 w-4" aria-hidden="true" />}
          className="ml-auto min-h-11"
        >
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
