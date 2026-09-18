import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Badge, Caption, GlassPanel, Input, Text, Textarea, Toggle } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'

interface Props {
  template: PackTemplate
  selection: PackSelection
  selected: boolean
  disabled: boolean
  onToggle: (selected: boolean) => void
  onChange: (selection: PackSelection) => void
}

export default function PackRulePreview({ template, selection, selected, disabled, onToggle, onChange }: Props) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()
  const rule = template.rule
  const value = selection.value_num ?? rule.value_num
  const numeric = rule.value_num != null
  return (
    <GlassPanel className="space-y-3 p-4">
      <Toggle label={t(`alertPacks.rules.${template.id}.name`, rule.name)} checked={selected} onChange={onToggle} disabled={disabled} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t(`notifications.alertStudio.severity.${rule.severity}`, rule.severity)}</Badge>
        <Text variant="bodySm">{rule.signal_name} {rule.op} {numeric ? (template.unit === '°C' ? formatTemperature(value) : `${value} ${template.unit}`) : String(rule.value_text ?? rule.value_bool ?? '')}</Text>
      </div>
      <Caption>{t('alertPacks.once', 'Fires once when the condition becomes true; resets when it becomes false. Changed-value rules fire on each change, subject to cooldown.')}</Caption>
      {selected && (
        <>
          {numeric && <Input
            label={t('alertPacks.threshold', 'Threshold ({{unit}})', { unit: template.unit })}
            type="number" step="any" value={selection.value_num ?? rule.value_num ?? ''}
            min={template.unit === '%' ? 0 : -100} max={100}
            disabled={disabled}
            onChange={e => onChange({ ...selection, value_num: e.target.value === '' ? NaN : Number(e.target.value) })}
          />}
          {template.unit === '°C' && <Caption>{t('alertPacks.canonicalTemperature', 'Enter Celsius; the trigger summary above also shows your preferred temperature unit.')}</Caption>}
          <Input label={t('alertPacks.cooldown', 'Minimum minutes between notifications')} type="number" min={1} max={10080}
            value={selection.cooldown_s == null ? rule.cooldown_min : selection.cooldown_s / 60} disabled={disabled}
            onChange={e => onChange({ ...selection, cooldown_s: Number(e.target.value) * 60 })} />
          <Textarea label={t('alertPacks.message', 'Notification message')} value={selection.message ?? rule.msg_template ?? ''}
            maxLength={1024} rows={3} disabled={disabled}
            onChange={e => onChange({ ...selection, message: e.target.value })} />
          <Caption>{t('alertPacks.placeholders', 'Keep the double-braced placeholder names unchanged.')}</Caption>
        </>
      )}
    </GlassPanel>
  )
}
