import { useTranslation } from 'react-i18next'
import type { NotificationChannel } from '@/api/hooks/useNotifications'
import { Button, Select } from '@/components/ui'
import { Icons } from '@/lib/icons'

interface Props {
  id: string
  channels: NotificationChannel[]
  value: number[] | null
  disabled: boolean
  compact?: boolean
  label?: string
  onChange: (value: number[] | null) => void
}

export default function PackRuleChannels({ id, channels, value, disabled, onChange, compact = false, label }: Props) {
  const { t } = useTranslation()
  const fieldLabel = label ?? t('alertPacks.channels', 'Channels')
  return <div className="space-y-2">
    <Select id={`pack-${id}-channels`} label={compact ? undefined : fieldLabel}
      aria-label={fieldLabel} className="h-11"
      disabled={disabled} value={value === null ? 'all' : value.length ? 'custom' : 'none'}
      options={[
        { value: 'all', label: t('alertPacks.inheritChannels', 'All enabled channels') },
        { value: 'none', label: t('alertPacks.noExternal', 'No external channels') },
        ...(value?.length ? [{ value: 'custom', label: t('alertPacks.channelsSelected', '{{count}} selected', { count: value.length }) }] : []),
        ...channels.filter(channel => !value?.includes(channel.id)).map(channel => ({
          value: String(channel.id), label: channel.enabled ? channel.name : `${channel.name} (${t('alertPacks.disabled', 'disabled')})`,
          disabled: (value?.length ?? 0) >= 100,
        })),
      ]}
      onChange={event => {
        const next = event.target.value
        if (next !== 'custom') onChange(next === 'all' ? null : next === 'none' ? [] : [...(value ?? []), Number(next)])
      }} />
    {value?.map(channelId => {
      const name = channels.find(channel => channel.id === channelId)?.name ?? t('alertPacks.missingChannel', 'Unavailable channel #{{id}}', { id: channelId })
      return <Button key={channelId} variant="secondary" size="sm" className="h-auto max-w-full whitespace-normal"
        disabled={disabled} aria-label={t('alertPacks.removeChannel', 'Remove {{name}}', { name })}
        onClick={() => onChange(value.filter(item => item !== channelId))}>
        {name}<Icons.close className="ms-1 h-3 w-3 shrink-0" aria-hidden="true" />
      </Button>
    })}
  </div>
}
