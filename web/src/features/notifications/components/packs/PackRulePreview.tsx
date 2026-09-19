import { useTranslation } from 'react-i18next'
import type { PackSelection, PackTemplate } from '@/api/hooks/useAlertPacks'
import type { NotificationChannel } from '@/api/hooks/useNotifications'
import { Badge, Checkbox, Text } from '@/components/ui'
import { SeverityBadge } from '@/components/data-display'
import { resolvePackChannels, withPackChannels, type PackDelivery } from './packDelivery'
import PackRuleTriggerEditor from './PackRuleTriggerEditor'
import PackRuleDeliveryEditor from './PackRuleDeliveryEditor'
import PackRuleMessageEditor from './PackRuleMessageEditor'
import PackRuleChannels from './PackRuleChannels'
import PackRuleResetButton from './PackRuleResetButton'

interface Props {
  template: PackTemplate
  selection: PackSelection
  selected: boolean
  disabled: boolean
  master: PackDelivery
  channels: NotificationChannel[]
  customized: boolean
  onToggle: (selected: boolean) => void
  onChange: (selection: PackSelection) => void
}

export default function PackRulePreview(props: Props) {
  const { t } = useTranslation()
  const { template, selection, selected, disabled, customized, channels, master, onToggle, onChange } = props
  const name = t(`alertPacks.rules.${template.id}.name`, template.rule.name)
  return <section aria-label={name} className="space-y-3 rounded-lg border border-[var(--border-default)] p-3">
    <div className="flex items-start gap-3">
      <Checkbox aria-label={name} checked={selected} onChange={onToggle} disabled={disabled} />
      <div className="min-w-0 flex-1 space-y-1">
        <Text as="p" variant="bodySm" weight="medium">{name}</Text>
        <div className="flex flex-wrap gap-1">
          <SeverityBadge severity={template.rule.severity} size="sm" />
          {customized && <Badge size="sm" variant="info">{t('alertPacks.customized', 'Customized')}</Badge>}
        </div>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <PackRuleTriggerEditor {...props} field="operator" />
      <PackRuleTriggerEditor {...props} field="value" />
      <PackRuleDeliveryEditor {...props} field="cooldown" />
      <PackRuleDeliveryEditor {...props} field="behavior" />
      <PackRuleChannels id={template.id} value={resolvePackChannels(selection, master)} channels={channels} disabled={disabled}
        onChange={channel_ids => onChange(withPackChannels(selection, channel_ids, master))} />
    </div>
    <PackRuleMessageEditor {...props} />
    <div className="flex items-center justify-between gap-2">
      <PackRuleDeliveryEditor {...props} field="title" />
      <PackRuleResetButton {...props} />
    </div>
  </section>
}
