import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { Badge, Button, Caption, Checkbox, Input, Text, Textarea, Toggle } from '@/components/ui'
import { SeverityBadge } from '@/components/data-display'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import PackDeliveryControls, { type PackDelivery } from './PackDeliveryControls'
import PackRuleCondition from './PackRuleCondition'

interface Props {
  template: PackTemplate
  selection: PackSelection
  selected: boolean
  disabled: boolean
  master: PackDelivery
  expanded: boolean
  customized: boolean
  onExpand: () => void
  editorOnly?: boolean
  onToggle: (selected: boolean) => void
  onChange: (selection: PackSelection) => void
}

export default function PackRulePreview({ template, selection, selected, disabled, master, expanded, customized, onExpand, onToggle, onChange, editorOnly = false }: Props) {
  const { t } = useTranslation()
  const rule = template.rule
  const numeric = rule.value_num != null
  const individual = selection.cooldown_s != null || selection.trigger_mode != null || selection.include_title != null
  const delivery: PackDelivery = {
    cooldown_s: selection.cooldown_s ?? master.cooldown_s,
    trigger_mode: selection.trigger_mode ?? master.trigger_mode,
    include_title: selection.include_title ?? master.include_title,
  }
  const name = t(`alertPacks.rules.${template.id}.name`, rule.name)
  const editor = expanded && (
        <div id={`pack-${template.id}-editor`} role="region" aria-label={t('alertPacks.customizeRule', 'Customize {{name}}', { name })}
          className="space-y-4 border-t border-[var(--border-default)] p-4">
          {!selected && <Caption className="block">{t('alertPacks.excludedRule', 'Not selected for installation. Your edits are kept if you select it again.')}</Caption>}
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
          {individual ? <div className="space-y-3">
            <PackDeliveryControls value={delivery} disabled={disabled} onChange={next => onChange({ ...selection, ...next })} />
            <Checkbox label={t('alertPacks.includeTitle', 'Include title in notifications')} checked={delivery.include_title}
              disabled={disabled} onChange={include_title => onChange({ ...selection, include_title })} />
          </div> : <Caption className="block">{t('alertPacks.inheritedDelivery', '{{minutes}} min cooldown · {{behavior}} · changes to master settings apply automatically.', {
            minutes: master.cooldown_s / 60,
            behavior: master.trigger_mode === 'once' ? t('alertPacks.behaviorOnce', 'Once until condition resets') : t('alertPacks.behaviorRepeat', 'Repeat after cooldown while active'),
          })}</Caption>}
          <Textarea id={`pack-${template.id}-message`} label={t('alertPacks.message', 'Notification message')} value={selection.message ?? rule.msg_template ?? ''}
            maxLength={1024} rows={3} disabled={disabled}
            onChange={e => onChange({ ...selection, message: e.target.value })} />
          <Caption className="block">{t('alertPacks.placeholders', 'Keep the double-braced placeholder names unchanged.')}</Caption>
        </div>
  )
  if (editorOnly) return editor
  return (
    <div className={cn('overflow-hidden rounded-lg border', expanded ? 'border-[var(--border-strong)] bg-[var(--surface-2)]' : 'border-[var(--border-default)]')}>
      <div className="flex items-start gap-3 p-3">
        <Checkbox aria-label={name} checked={selected} onChange={onToggle} disabled={disabled} className="mt-3 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <Button variant="ghost" className="h-auto w-full min-w-0 justify-start whitespace-normal px-0 py-1 text-start"
            aria-label={t('alertPacks.customizeRule', 'Customize {{name}}', { name })}
            aria-expanded={expanded} aria-controls={`pack-${template.id}-editor`} onClick={onExpand} disabled={disabled}>
            <Text as="span" variant="bodySm" weight="medium" className="min-w-0 flex-1 break-words">{name}</Text>
            <Icons.edit className="ms-2 h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
          <PackRuleCondition template={template} selection={selection} />
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={rule.severity} size="sm" />
            {customized && <Badge size="sm" variant="info">{t('alertPacks.customized', 'Customized')}</Badge>}
            <Caption>{individual
              ? t('alertPacks.customDelivery', 'Own settings · {{minutes}} min', { minutes: delivery.cooldown_s / 60 })
              : t('alertPacks.followsMaster', 'Follows master settings')}</Caption>
          </div>
        </div>
      </div>
      {editor}
    </div>
  )
}
