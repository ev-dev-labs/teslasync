import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import { AIAlertMessageTemplateButton } from '@/components/ai/AIAlertMessageTemplateButton'
import { Textarea } from '@/components/ui'

interface Props {
  template: PackTemplate
  selection: PackSelection
  disabled: boolean
  compact?: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleMessageEditor({ template, selection, disabled, onChange, compact = false }: Props) {
  const { t } = useTranslation()
  const message = selection.message ?? template.rule.msg_template ?? ''
  return <div className="space-y-2">
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Textarea id={`pack-${template.id}-message`} label={compact ? undefined : t('alertPacks.message', 'Notification message')}
          aria-label={t('alertPacks.message', 'Notification message')}
          className={compact ? 'block min-h-24 w-full resize-y' : 'block min-h-24'} rows={3} maxLength={1024} disabled={disabled}
          value={message} error={message.trim() ? undefined : t('alertPacks.messageRequired', 'Enter a notification message.')}
          onChange={event => onChange({ ...selection, message: event.target.value })} />
      </div>
      <AIAlertMessageTemplateButton disabled={disabled || (template.rule.value_num != null && !Number.isFinite(selection.value_num ?? template.rule.value_num))}
        draft={{ ...template.rule, name: t(`alertPacks.rules.${template.id}.name`, template.rule.name),
          op: selection.op ?? template.rule.op, value_num: selection.value_num ?? template.rule.value_num }}
        onApplyTemplate={message => onChange({ ...selection, message })} />
    </div>
  </div>
}
