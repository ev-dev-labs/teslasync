import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveAlertRule, type AlertRule, type NotificationChannel } from '@/api/hooks/useNotifications'
import { Button, Caption, Checkbox, Modal, Text, Toggle } from '@/components/ui'
import { ErrorDisplay } from '@/components/feedback'

interface Props {
  rule: AlertRule
  channels: NotificationChannel[]
  onClose: () => void
}

export default function RuleChannelDialog({ rule, channels, onClose }: Props) {
  const { t } = useTranslation()
  const save = useSaveAlertRule()
  const [ids, setIds] = useState<number[] | null>(rule.channel_ids ?? null)
  const missing = (ids ?? []).filter(id => !channels.some(channel => channel.id === id))
  return (
    <Modal open title={t('alertPacks.ruleChannels', 'Channels for {{name}}', { name: rule.name })} onClose={() => { if (!save.isPending) onClose() }}>
      <div className="space-y-4">
        <Text as="p">{t('alertPacks.channelHelp', 'Choose external delivery channels for this rule. Browser notifications and quiet hours are unchanged. Disabled channels do not deliver.')}</Text>
        <Toggle label={t('alertPacks.allChannels', 'All enabled channels, including future channels')} checked={ids === null} disabled={save.isPending}
          onChange={all => setIds(all ? null : channels.filter(channel => channel.enabled).map(channel => channel.id))} />
        {ids !== null && <div className="space-y-2">
          {channels.map(channel => <Checkbox key={channel.id} label={`${channel.name} (${channel.kind})`}
            checked={ids.includes(channel.id)} disabled={save.isPending}
            onChange={checked => setIds(previous => checked ? [...(previous ?? []), channel.id] : (previous ?? []).filter(id => id !== channel.id))} />)}
          {ids.length === 0 && <Caption>{t('alertPacks.noExternalHelp', 'No external channels selected. This rule still appears in the browser.')}</Caption>}
          {missing.length > 0 && <Button variant="ghost" onClick={() => setIds(previous => (previous ?? []).filter(id => !missing.includes(id)))}>
            {t('alertPacks.clearMissingChannels', 'Remove unavailable channel selections')}
          </Button>}
        </div>}
        {save.error && <ErrorDisplay error={save.error} compact />}
        <div className="flex flex-wrap gap-2">
          <Button loading={save.isPending} disabled={save.isPending || missing.length > 0}
            onClick={() => save.mutate({ id: rule.id, channel_ids: ids }, { onSuccess: onClose })}>{t('common.save', 'Save')}</Button>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        </div>
      </div>
    </Modal>
  )
}
