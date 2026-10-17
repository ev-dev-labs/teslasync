import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Input, Select } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'

interface Props {
  template: PackTemplate
  selection: PackSelection
  disabled: boolean
  field: 'operator' | 'value'
  compact?: boolean
  selected?: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleTriggerEditor({ template, selection, disabled, onChange, field, compact = false, selected = true }: Props) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()
  const numeric = template.rule.value_num != null
  const changed = template.rule.op === 'changed'
  const operators = numeric ? ['<', '<=', '>', '>=', '=', '!='] : ['=', '!=']
  const operatorLabel = t('alertPacks.operator', 'Operator')
  const valueLabel = numeric ? t('alertPacks.threshold', 'Threshold ({{unit}})', { unit: template.unit }) : t('alertPacks.valueColumn', 'Value')
  const value = selection.value_num ?? template.rule.value_num
  const min = template.unit === '%' ? 0 : -100
  const invalid = selected && numeric && (value == null || !Number.isFinite(value) || value < min || value > 100)
  if (field === 'operator') return <Select id={`pack-${template.id}-operator`}
        label={compact ? undefined : operatorLabel} aria-label={operatorLabel} className="h-11"
        value={selection.op ?? template.rule.op} disabled={disabled}
        options={changed ? [{ value: 'changed', label: t('alertPacks.changedOperator', 'Changes') }] : operators.map(value => ({ value, label: value }))}
        onChange={event => onChange({ ...selection, op: event.target.value })} />
  if (numeric) return <Input id={`pack-${template.id}-threshold`} label={compact ? undefined : valueLabel} aria-label={valueLabel}
        error={invalid ? `${t('common.invalidNumber', 'Enter a valid number')} (${min}-100)` : undefined}
        type="number" step="any" className="h-11 min-w-0" value={Number.isNaN(selection.value_num) ? '' : selection.value_num ?? template.rule.value_num ?? ''}
        suffix={template.unit || undefined}
        title={template.unit === '°C' ? t('alertPacks.temperatureValueHelp', 'Enter Celsius. Display equivalent: {{value}}', {
          value: formatTemperature(selection.value_num ?? template.rule.value_num),
        }) : undefined}
        min={min} max={100} disabled={disabled}
        onChange={event => onChange({ ...selection, value_num: event.target.value === '' ? NaN : Number(event.target.value) })} />
  return <Input label={compact ? undefined : valueLabel} aria-label={valueLabel} className="h-11" readOnly disabled={disabled}
    value={changed ? t('alertPacks.anyValue', 'Any value') : String(template.rule.value_text ?? template.rule.value_bool ?? '')} />
}
