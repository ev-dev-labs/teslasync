import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, Textarea } from '@/components/ui';
import { UnitInput } from '@/components/forms';
import { typography } from '@/lib/tokens';
import type { AutomationActionCommandStepInput } from '../stepInputTypes';
import { COMMAND_GROUPS, GUIDED_COMMAND_FIELDS } from './actionOptions';
import { isCommandParams } from './actionHelpers';

interface ActionCommandFieldsProps {
  action: AutomationActionCommandStepInput;
  onChange: (action: AutomationActionCommandStepInput) => void;
}

export function ActionCommandFields({ action, onChange }: ActionCommandFieldsProps) {
  const { t } = useTranslation();
  const commandId = useId();
  const guidedFields = GUIDED_COMMAND_FIELDS[action.command_name] ?? [];
  // Keep the user's JSON draft across controlled updates; the row's original
  // kind/index key still owns remounts, not each successful JSON parse.
  const [paramsText, setParamsText] = useState<string>(() => (
    action.command_params ? JSON.stringify(action.command_params, null, 2) : ''
  ));
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(
    action.command_params &&
    Object.keys(action.command_params).some((key) => !guidedFields.some((field) => field.key === key)),
  ));

  const commandOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectCommand', 'Select command...') },
      ...COMMAND_GROUPS.flatMap((group) => {
        const groupLabel = t(group.labelKey, group.fallback);
        return group.commands.map((command) => ({
          value: command.value,
          label: `${groupLabel} - ${t(command.labelKey, command.fallback)}`,
        }));
      }),
    ],
    [t],
  );

  return (
    <div className="min-w-0 space-y-4">
      <Select
        id={commandId}
        label={t('automations.builder.command', 'Command')}
        options={commandOptions}
        value={action.command_name}
        onChange={(event) => {
          setParamsText('');
          setParamsError(null);
          setShowAdvanced(false);
          onChange({ ...action, command_name: event.target.value, command_params: undefined });
        }}
        className="w-full sm:max-w-md"
      />
      {guidedFields.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {guidedFields.map(({ key, labelKey, fallback, min, max }) => (
            <UnitInput
              key={key}
              label={t(labelKey, fallback)}
              unit={action.command_name === 'set_temps' ? 'temperature' : key === 'percent' ? 'percent' : 'count'}
              min={min}
              max={max}
              value={typeof action.command_params?.[key] === 'number'
                ? action.command_params[key] : null}
              commitOnChange
              onChange={(value) => {
                const next = { ...action.command_params };
                if (value === null) delete next[key];
                else next[key] = value;
                const command_params = Object.keys(next).length ? next : undefined;
                setParamsText(command_params ? JSON.stringify(command_params, null, 2) : '');
                onChange({ ...action, command_params });
              }}
              className="w-full"
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        wrapLabel
        disabled={showAdvanced && Boolean(paramsError)}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced
          ? t('automations.builder.hideAdvancedParams', 'Hide advanced parameters')
          : t('automations.builder.showAdvancedParams', 'Advanced parameters (JSON)')}
      </Button>
      {showAdvanced && (
        <Textarea
          label={t('automations.builder.commandParams', 'Params (JSON, optional)')}
          value={paramsText}
          onChange={(event) => {
            const nextText = event.target.value;
            setParamsText(nextText);
            if (!nextText.trim()) {
              setParamsError(null);
              event.target.setCustomValidity('');
              onChange({ ...action, command_params: undefined });
              return;
            }
            try {
              const parsed: unknown = JSON.parse(nextText);
              if (!isCommandParams(parsed)) {
                const message = t(
                  'automations.builder.commandParamsObjectError',
                  'Params must be a JSON object.',
                );
                setParamsError(message);
                event.target.setCustomValidity(message);
                return;
              }
              setParamsError(null);
              event.target.setCustomValidity('');
              onChange({ ...action, command_params: parsed });
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : t('automations.builder.invalidJson', 'Invalid JSON');
              setParamsError(message);
              event.target.setCustomValidity(message);
            }
          }}
          placeholder={t('automations.builder.commandParamsPlaceholder', '{}')}
          rows={2}
          error={paramsError ?? undefined}
          className={typography.role.code}
        />
      )}
    </div>
  );
}
