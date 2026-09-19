import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Caption, Input, Select } from '@/components/ui'
import PackRuleCondition from './PackRuleCondition'

interface Props {
  template: PackTemplate
  selection: PackSelection
  disabled: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleTriggerEditor({ template, selection, disabled, onChange }: Props) {
  const { t } = useTranslation()
  const numeric = template.rule.value_num != null
  const changed = template.rule.op === 'changed'
  const operators = numeric ? ['<', '<=', '>', '>=', '=', '!='] : ['=', '!=']
  return <div className="space-y-2">
    <PackRuleCondition template={template} selection={selection} />
    {!changed && <div className="flex items-end gap-2">
      <div className="w-20 shrink-0"><Select id={`pack-${template.id}-operator`} label={t('alertPacks.operator', 'Operator')}
        value={selection.op ?? template.rule.op} disabled={disabled}
        options={operators.map(value => ({ value, label: value }))}
        onChange={event => onChange({ ...selection, op: event.target.value })} /></div>
      {numeric && <div className="min-w-0 flex-1"><Input id={`pack-${template.id}-threshold`} label={t('alertPacks.threshold', 'Threshold ({{unit}})', { unit: template.unit })}
        type="number" step="any" className="min-w-0" value={Number.isNaN(selection.value_num) ? '' : selection.value_num ?? template.rule.value_num ?? ''}
        min={template.unit === '%' ? 0 : -100} max={100} disabled={disabled}
        onChange={event => onChange({ ...selection, value_num: event.target.value === '' ? NaN : Number(event.target.value) })} /></div>}
    </div>}
    {template.unit === '°C' && <Caption className="block">{t('alertPacks.canonicalTemperature', 'Enter Celsius; the trigger summary above also shows your preferred temperature unit.')}</Caption>}
  </div>
}
