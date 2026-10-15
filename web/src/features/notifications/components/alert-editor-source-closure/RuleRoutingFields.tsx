import { Button as UiButton, Select as UiSelect, Caption } from '@/components/ui'
import { StaleRefreshWarning } from '@/components/feedback'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function RuleRoutingFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, channelsState, ruleChannelIds, setEditor, allChannelIds, channelsList } = controller
  return (
    <div className="mb-4">
      <StaleRefreshWarning state={channelsState} label={t('alertPacks.ruleChannels', 'Rule delivery channels')} />
      <UiSelect
        id="alert-rule-channel-routing"
        label={t('alertPacks.ruleChannels', 'Rule delivery channels')}
        value={ruleChannelIds === null ? 'inherit' : ruleChannelIds.length === 0 ? 'none' : 'custom'}
        onChange={event => setEditor(current => ({
          ...current,
          channel_ids: event.target.value === 'inherit' ? null : event.target.value === 'none' ? [] : allChannelIds,
        }))}
        options={[
          { value: 'inherit', label: t('alertPacks.inheritChannels', 'All enabled channels') },
          { value: 'none', label: t('alertPacks.noExternal', 'No external channels') },
          { value: 'custom', label: t('notifications.alertStudio.channels.selectChannels', 'Selected channels') },
        ]}
      />
      {ruleChannelIds !== null && ruleChannelIds.length > 0 && channelsList.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {channelsList.map(channel => (
            <UiButton
              wrapLabel
              key={channel.id}
              variant="ghost"
              size="sm"
              aria-pressed={ruleChannelIds.includes(channel.id)}
              onClick={() => setEditor(current => {
                const selected = Array.isArray(current.channel_ids) ? current.channel_ids : []
                return {
                  ...current,
                  channel_ids: selected.includes(channel.id)
                    ? selected.filter(id => id !== channel.id) : [...selected, channel.id],
                }
              })}
            >
              {channel.name}
            </UiButton>
          ))}
        </div>
      )}
      {ruleChannelIds?.filter(id => !allChannelIds.includes(id)).map(id => (
        <Caption key={id} className="mt-2 block break-words">
          {t('alertPacks.missingChannel', 'Unavailable channel #{{id}}', { id })}
        </Caption>
      ))}
    </div>
  )
}
