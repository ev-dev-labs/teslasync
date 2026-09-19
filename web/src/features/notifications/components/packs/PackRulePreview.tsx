import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Badge, Caption, GlassPanel, Input, Text, Textarea, Toggle } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import PackDeliveryControls, { type PackDelivery } from './PackDeliveryControls'

interface Props {
  template: PackTemplate
  selection: PackSelection
  selected: boolean
  disabled: boolean
  master: PackDelivery
  onToggle: (selected: boolean) => void
  onChange: (selection: PackSelection) => void
}

export default function PackRulePreview({ template, selection, selected, disabled, master, onToggle, onChange }: Props) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()
  const rule = template.rule
  const value = selection.value_num ?? rule.value_num
  const numeric = rule.value_num != null
  const individual = selection.cooldown_s != null || selection.trigger_mode != null || selection.include_title != null
  const delivery: PackDelivery = {
    cooldown_s: selection.cooldown_s ?? master.cooldown_s,
    trigger_mode: selection.trigger_mode ?? master.trigger_mode,
    include_title: selection.include_title ?? master.include_title,
  }
  return (
    <GlassPanel className="space-y-3 p-4">
      <Toggle label={t(`alertPacks.rules.${template.id}.name`, rule.name)} checked={selected} onChange={onToggle} disabled={disabled} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t(`notifications.alertStudio.severity.${rule.severity}`, rule.severity)}</Badge>
        <Text variant="bodySm">{rule.signal_name} {rule.op} {numeric ? (template.unit === '°C' ? formatTemperature(value) : `${value} ${template.unit}`) : String(rule.value_text ?? rule.value_bool ?? '')}</Text>
      </div>
      {selected && (
        <>
          {numeric && <Input
            id={`pack-${template.id}-threshold`}
            label={t('alertPacks.threshold', 'Threshold ({{unit}})', { unit: template.unit })}
            type="number" step="any" value={selection.value_num ?? rule.value_num ?? ''}
            min={template.unit === '%' ? 0 : -100} max={100}
            disabled={disabled}
            onChange={e => onChange({ ...selection, value_num: e.target.value === '' ? NaN : Number(e.target.value) })}
          />}
          {template.unit === '°C' && <Caption>{t('alertPacks.canonicalTemperature', 'Enter Celsius; the trigger summary above also shows your preferred temperature unit.')}</Caption>}
          <Toggle label={t('alertPacks.individualSettings', 'Use individual delivery settings')} checked={individual} disabled={disabled}
            onChange={checked => {
              const { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, ...rest } = selection
              onChange(checked ? { ...rest, ...delivery } : rest)
            }} />
          <PackDeliveryControls value={delivery} disabled={disabled || !individual} onChange={next => onChange({ ...selection, ...next })} />
          <Toggle label={t('alertPacks.includeTitle', 'Include title in notifications')} checked={delivery.include_title}
            disabled={disabled || !individual} onChange={include_title => onChange({ ...selection, include_title })} />
          <Textarea id={`pack-${template.id}-message`} label={t('alertPacks.message', 'Notification message')} value={selection.message ?? rule.msg_template ?? ''}
            maxLength={1024} rows={3} disabled={disabled}
            onChange={e => onChange({ ...selection, message: e.target.value })} />
          <Caption>{t('alertPacks.placeholders', 'Keep the double-braced placeholder names unchanged.')}</Caption>
        </>
      )}
    </GlassPanel>
  )
}
