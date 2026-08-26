import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import {
  useCloseDrive,
  useDiscardDrive,
  useUpdateDrive,
  type RepairPatch,
  type StaleDrive,
} from '@/api/hooks/useDataRepair';
import { isRFC3339Boundary } from './repairPresentation';
import { RepairFormActions } from './RepairFormActions';

export interface DriveRepairFormProps {
  drive: StaleDrive;
  /** DOM id so the triggering row can reference this form via `aria-controls`. */
  formId: string;
  onClose: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Non-empty, finite numeric string → keep; otherwise drop from the patch.
 *
 * The `Number.isFinite` guard is load-bearing: `Number('abc')` is `NaN` and
 * `Number('1e999')` is `Infinity`, both of which are `!= null`. Without the
 * guard they leak into the patch and `JSON.stringify` serialises them to
 * `null`, silently nulling the SI column the operator meant to repair.
 */
function num(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `DriveRepairForm` — inline SI editor for one stale drive.
 *
 * Inputs are entered in SI (m, s, m/s) to match the `drives` columns the
 * backend `DrivePartialAllowed` whitelist accepts; a live `useUnits()` hint
 * shows the equivalent in the operator's preferred display unit. Save patches
 * only non-boundary fields; Close applies the explicitly entered `ended_at`
 * after confirmation; Discard deletes after confirmation.
 */
export function DriveRepairForm({
  drive,
  formId,
  onClose,
  disabled = false,
  disabledReason,
}: DriveRepairFormProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration, formatSpeed } = useUnits();

  const [form, setForm] = useState({
    ended_at: '',
    distance_m: String(drive.distance_m ?? ''),
    duration_s: String(drive.duration_s ?? ''),
    end_soc_pct: String(drive.end_battery_pct ?? ''),
    max_speed_mps: String(drive.max_speed_mps ?? ''),
    avg_speed_mps: String(drive.avg_speed_mps ?? ''),
  });

  const update = useUpdateDrive();
  const close = useCloseDrive();
  const discard = useDiscardDrive();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSave = () => {
    const patch: RepairPatch = {};
    const distance = num(form.distance_m);
    if (distance != null) patch.distance_m = distance;
    const duration = num(form.duration_s);
    if (duration != null) patch.duration_s = duration;
    const endSoc = num(form.end_soc_pct);
    if (endSoc != null) patch.end_soc_pct = endSoc;
    const maxSpeed = num(form.max_speed_mps);
    if (maxSpeed != null) patch.max_speed_mps = maxSpeed;
    const avgSpeed = num(form.avg_speed_mps);
    if (avgSpeed != null) patch.avg_speed_mps = avgSpeed;
    update.mutate({ id: drive.id, patch }, { onSuccess: onClose });
  };
  const endedAt = form.ended_at.trim();
  const validEndedAt = isRFC3339Boundary(endedAt);
  const onCloseBoundary = () => close.mutate({
    id: drive.id,
    ended_at: endedAt,
    rule: 'manual',
    expected_stored_ended_at: drive.end_ts ?? '',
  }, { onSuccess: onClose });

  // Derive the live display-unit hint from the SAME `num()` predicate the save
  // path uses, so the hint and the patch agree on what counts as a valid entry:
  // an empty or non-finite field shows no hint rather than a bare em dash.
  const unitHint = (value: string, formatter: (n: number) => string): string | undefined => {
    const parsed = num(value);
    return parsed != null ? formatter(parsed) : undefined;
  };

  const distanceHint = unitHint(form.distance_m, formatDistance);
  const durationHint = unitHint(form.duration_s, formatDuration);
  const maxSpeedHint = unitHint(form.max_speed_mps, formatSpeed);
  const avgSpeedHint = unitHint(form.avg_speed_mps, formatSpeed);

  return (
    <div
      id={formId}
      role="region"
      aria-label={t('dataRepair.drive.formLabel', 'Repair drive #{{id}}', { id: drive.id })}
      className="mt-2 space-y-4 rounded-lg bg-amber-500/[0.04] p-3 ring-1 ring-amber-400/20 sm:p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <Input
          label={t('dataRepair.field.endedAt', 'End Date/Time (ISO)')}
          value={form.ended_at}
          placeholder="2026-03-30T04:00:00Z"
          onChange={set('ended_at')}
          error={endedAt && !validEndedAt
            ? t('dataRepair.field.invalidEndedAt', 'Use RFC3339 format, including a timezone.')
            : undefined}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.distanceM', 'Distance (m)')}
          type="number"
          value={form.distance_m}
          onChange={set('distance_m')}
          hint={distanceHint}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.durationS', 'Duration (s)')}
          type="number"
          value={form.duration_s}
          onChange={set('duration_s')}
          hint={durationHint}
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
          label={t('dataRepair.field.maxSpeedMps', 'Max Speed (m/s)')}
          type="number"
          value={form.max_speed_mps}
          onChange={set('max_speed_mps')}
          hint={maxSpeedHint}
          disabled={disabled}
        />
        <Input
          label={t('dataRepair.field.avgSpeedMps', 'Avg Speed (m/s)')}
          type="number"
          value={form.avg_speed_mps}
          onChange={set('avg_speed_mps')}
          hint={avgSpeedHint}
          disabled={disabled}
        />
      </div>

      <RepairFormActions
        kind="drive"
        sessionId={drive.id}
        onSave={onSave}
        onCloseBoundary={onCloseBoundary}
        onDiscard={() => discard.mutate(drive.id, { onSuccess: onClose })}
        onCancel={onClose}
        savePending={update.isPending}
        closePending={close.isPending}
        discardPending={discard.isPending}
        closeDisabled={!validEndedAt}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </div>
  );
}
