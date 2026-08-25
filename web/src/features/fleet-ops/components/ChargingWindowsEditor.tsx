import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorText, Input, Select } from '@/components/ui';
import type { EditableChargingWindow } from './chargingWindowUtils';

interface ChargingWindowsEditorProps {
  value: EditableChargingWindow[];
  onChange: (value: EditableChargingWindow[]) => void;
  error?: string;
}

const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function ChargingWindowsEditor({ value, onChange, error }: ChargingWindowsEditorProps) {
  const { t } = useTranslation();
  const errorId = useId();
  const update = (key: string, patch: Partial<EditableChargingWindow>) => {
    onChange(value.map((window) => window.key === key ? { ...window, ...patch } : window));
  };
  const add = () => onChange([
    ...value,
    {
      key: `new-${Date.now()}-${value.length}`,
      day_of_week: 1,
      start_local_time: '00:00',
      end_local_time: '06:00',
    },
  ]);

  return (
    <fieldset
      className="space-y-3 rounded-xl border border-[var(--glass-border)] p-4"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold text-[var(--text-primary)]">
          {t('fleetOps.policyDialog.windows', 'Allowed charging windows')}
        </legend>
        <Button type="button" size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={add}>
          {t('fleetOps.policyDialog.addWindow', 'Add window')}
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {t('fleetOps.policyDialog.noWindows', 'Add at least one local-time window. Overnight windows are supported.')}
        </p>
      ) : value.map((window) => (
        <div key={window.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Select
            label={t('fleetOps.policyDialog.day', 'Day')}
            value={window.day_of_week.toString()}
            onChange={(event) => update(window.key, { day_of_week: Number(event.target.value) })}
            options={dayKeys.map((key, index) => ({
              value: index.toString(),
              label: t(`fleetOps.days.${key}`, key.toUpperCase()),
            }))}
          />
          <Input
            label={t('fleetOps.policyDialog.windowStart', 'Start')}
            type="time"
            value={window.start_local_time}
            onChange={(event) => update(window.key, { start_local_time: event.target.value })}
            required
          />
          <Input
            label={t('fleetOps.policyDialog.windowEnd', 'End')}
            type="time"
            value={window.end_local_time}
            onChange={(event) => update(window.key, { end_local_time: event.target.value })}
            required
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 px-0 text-rose-300"
            aria-label={t('fleetOps.policyDialog.removeWindow', 'Remove charging window')}
            onClick={() => onChange(value.filter((candidate) => candidate.key !== window.key))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </fieldset>
  );
}
