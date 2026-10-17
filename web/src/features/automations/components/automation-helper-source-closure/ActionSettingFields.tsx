import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select } from '@/components/ui';
import { UnitInput } from '@/components/forms';
import { useSettings } from '@/hooks/useSettings';
import { parseForUnit } from '@/lib/unitInput';
import type {
  AutomationActionSetSettingStepInput,
  AutomationActionStepInput,
} from '../stepInputTypes';
import { actionWithSettingValue, settingValueKind, type SettingValueKind } from './actionHelpers';

interface ActionSettingFieldsProps {
  action: AutomationActionSetSettingStepInput;
  onChange: (action: AutomationActionStepInput) => void;
}

export function ActionSettingFields({ action, onChange }: ActionSettingFieldsProps) {
  const { t } = useTranslation();
  const valueTypeId = useId();
  const booleanValueId = useId();
  const { settings } = useSettings();
  const valueKind = settingValueKind(action);
  const value = valueKind === 'number'
    ? action.value_num == null ? '' : String(action.value_num)
    : valueKind === 'boolean'
      ? String(action.value_bool ?? false)
      : (action.value_text ?? '');

  return (
    <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>div]:min-w-0">
      <Input
        label={t('automations.builder.settingKey', 'Setting key')}
        value={action.setting_key}
        onChange={(event) => onChange({ ...action, setting_key: event.target.value })}
        placeholder={t('automations.builder.settingKeyPlaceholder', 'charge_limit')}
        className="w-full"
      />
      <Select
        id={valueTypeId}
        label={t('automations.builder.valueType', 'Value type')}
        options={[
          { value: 'text', label: t('automations.builder.valueText', 'Text') },
          { value: 'number', label: t('automations.builder.valueNumber', 'Number') },
          { value: 'boolean', label: t('automations.builder.valueBoolean', 'Boolean') },
        ]}
        value={valueKind}
        onChange={(event) => {
          const nextKind = event.target.value as SettingValueKind;
          onChange(actionWithSettingValue(action, nextKind,
            nextKind === 'number' ? parseForUnit(value, 'number', settings) : value));
        }}
        className="w-full"
      />
      {valueKind === 'boolean' ? (
        <Select
          id={booleanValueId}
          label={t('automations.builder.value', 'Value')}
          options={[
            { value: 'true', label: t('common.true', 'True') },
            { value: 'false', label: t('common.false', 'False') },
          ]}
          value={value}
          onChange={(event) => onChange(actionWithSettingValue(action, valueKind, event.target.value))}
          className="w-full"
        />
      ) : valueKind === 'number' ? (
        <UnitInput
          label={t('automations.builder.value', 'Value')}
          unit="number"
          value={action.value_num ?? null}
          commitOnChange
          onChange={(next) => onChange(actionWithSettingValue(action, valueKind, next))}
          placeholder={t('automations.builder.valueNumberPlaceholder', '80')}
          className="w-full"
        />
      ) : (
        <Input
          label={t('automations.builder.value', 'Value')}
          value={value}
          onChange={(event) => onChange(actionWithSettingValue(action, valueKind, event.target.value))}
          placeholder={t('automations.builder.valueTextPlaceholder', 'enabled')}
          className="w-full"
        />
      )}
    </div>
  );
}
