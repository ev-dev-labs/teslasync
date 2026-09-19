import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Caption } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'

interface Props {
  template: PackTemplate
  selection: PackSelection
}

export default function PackRuleCondition({ template, selection }: Props) {
  const { formatTemperature } = useUnits()
  const rule = template.rule
  const value = selection.value_num ?? rule.value_num
  const operand = rule.value_num != null
    ? !Number.isFinite(value) ? '—' : template.unit === '°C' ? formatTemperature(value) : `${value} ${template.unit}`
    : String(rule.value_text ?? rule.value_bool ?? '')
  return <Caption className="block break-words">{rule.signal_name} {rule.op} {operand}</Caption>
}
