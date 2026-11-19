import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Select } from '@/components/ui';
import type { CommandDef, Vehicle } from '../../commands';
import { validateField } from '../CommandInputDialog';
import { buildCommandParams } from './commandInput';

interface CommandInlineInputProps {
  definition: CommandDef;
  vehicle: Vehicle;
  blocked: boolean;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandInlineInput({ definition, vehicle, blocked, onExecute }: CommandInlineInputProps) {
  const { t } = useTranslation();
  const config = definition.inputConfig;
  const select = definition.selectConfig;
  const [value, setValue] = useState(() => config?.getDefaultValue?.({ vehicle })
    ?? config?.defaultValue ?? '');
  const [touched, setTouched] = useState(false);
  const label = t(definition.labelKey, definition.labelFallback);
  const error = config ? validateField(value, config.validation, config.min, config.max) : null;
  const valid = select ? select.options.some(option => option.value === value) : !error;
  const slider = definition.id === 'set_charge_limit';

  function apply() {
    setTouched(true);
    if (blocked || !valid) return;
    onExecute(definition.command, select ? {
      ...definition.params, [select.paramName]: value,
    } : buildCommandParams(definition, { [config!.paramName]: value }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-28">
          {select ? (
            <Select
              aria-label={label}
              value={value}
              disabled={blocked}
              onChange={event => setValue(event.target.value)}
              className="min-h-11 md:min-h-11"
              options={[
                { value: '', label: t('commands.board.choose', 'Choose a value') },
                ...select.options.map(option => ({
                  value: option.value,
                  label: [
                    t(option.labelKey, option.labelFallback),
                    option.descriptionKey && t(option.descriptionKey, option.descriptionFallback ?? ''),
                  ].filter(Boolean).join(' · '),
                })),
              ]}
            />
          ) : (
            <Input
              aria-label={label}
              value={value}
              disabled={blocked}
              inputMode={config?.validation === 'number' ? 'numeric'
                : config?.validation === 'decimal' ? 'decimal' : 'text'}
              onChange={event => setValue(event.target.value)}
              onBlur={() => setTouched(true)}
              error={touched && error ? t(error.key, error.fallback, error.values) : undefined}
              suffix={config?.unit}
              className="min-h-11"
              autoComplete="off"
            />
          )}
        </div>
        <Button type="button" variant="secondary" wrapLabel className="min-h-11"
          disabled={blocked || !valid} onClick={apply}>
          {t('common.apply', 'Apply')}
        </Button>
      </div>
      {slider && (
        <Input type="range" min={config?.min} max={config?.max} step={1}
          aria-label={t('commands.board.chargeLimitDraft', 'Charge limit draft')}
          value={valid ? value : config?.defaultValue} disabled={blocked}
          onChange={event => setValue(event.target.value)} className="min-h-11 accent-[var(--theme-primary)]" />
      )}
    </div>
  );
}
