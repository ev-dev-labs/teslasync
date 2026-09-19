import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { AIAlertMessageTemplateButton } from '@/components/ai/AIAlertMessageTemplateButton'
import { Checkbox, Textarea } from '@/components/ui'
import type { PackDelivery } from './PackDeliveryControls'

interface Props {
  template: PackTemplate
  selection: PackSelection
  master: PackDelivery
  disabled: boolean
  compact?: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleMessageEditor({ template, selection, master, disabled, onChange, compact = false }: Props) {
  const { t } = useTranslation()
  const message = selection.message ?? template.rule.msg_template ?? ''
  return <div className="space-y-2">
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Textarea id={`pack-${template.id}-message`} label={compact ? undefined : t('alertPacks.message', 'Notification message')}
          aria-label={t('alertPacks.message', 'Notification message')}
          className="min-h-20 focus:min-h-36" rows={2} maxLength={1024} disabled={disabled}
          value={message} error={message.trim() ? undefined : t('alertPacks.messageRequired', 'Enter a notification message.')}
          onChange={event => onChange({ ...selection, message: event.target.value })} />
      </div>
      <AIAlertMessageTemplateButton disabled={disabled || (template.rule.value_num != null && !Number.isFinite(selection.value_num ?? template.rule.value_num))}
        draft={{ ...template.rule, name: t(`alertPacks.rules.${template.id}.name`, template.rule.name),
          op: selection.op ?? template.rule.op, value_num: selection.value_num ?? template.rule.value_num }}
        onApplyTemplate={message => onChange({ ...selection, message })} />
    </div>
    <Checkbox label={t('alertPacks.includeTitle', 'Include title in notifications')}
      checked={selection.include_title ?? master.include_title} disabled={disabled}
      onChange={include_title => onChange({ ...selection, include_title })} />
  </div>
}
