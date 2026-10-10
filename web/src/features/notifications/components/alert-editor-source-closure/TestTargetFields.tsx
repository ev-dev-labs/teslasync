import { GlassPanel, Button as UiButton, Text, Caption, HelperText } from '@/components/ui'
import { EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function TestTargetFields({ controller }: { controller: AlertRuleEditorController }) {
  const {
    t, testChannelIds, allChannelIds, channelsLoading, channelsError,
    channelsQuery, channelsList, handleToggleTestChannel,
  } = controller
  return (
    <div className="mb-4">
      <Text as="p" variant="label" className="mb-2">
        {t('notifications.alertStudio.channels.testTargetLabel', 'Test delivery target')}
      </Text>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <Text variant="bodySm">
            {t('notifications.alertStudio.channels.browserToast', 'Browser toast notification (real-time via SSE)')}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <Text variant="bodySm">
            {t('notifications.alertStudio.channels.alertHistory', 'Alert history (saved to database)')}
          </Text>
        </div>
        <GlassPanel className="p-3" data-tour="alert-studio-channels">
          {testChannelIds?.filter(id => !allChannelIds.includes(id)).map(id => (
            <Caption key={id} className="mb-2 block break-words">
              {t('alertPacks.missingChannel', 'Unavailable channel #{{id}}', { id })}
            </Caption>
          ))}
          {channelsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48 rounded-lg" />
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-28 rounded-lg" />)}
              </div>
            </div>
          ) : channelsError ? (
            <ErrorDisplay error={channelsError} compact onRetry={() => { void channelsQuery.refetch(); }} />
          ) : channelsList.length > 0 ? (
            <div>
              <HelperText className="mb-1.5">
                {t('notifications.alertStudio.channels.externalChannels', 'External channels for test notifications:')}
              </HelperText>
              <div className="flex flex-wrap gap-2">
                {channelsList.map(ch => {
                  const isSelected = testChannelIds === null || testChannelIds.includes(ch.id)
                  return (
                    <UiButton
                      wrapLabel
                      key={ch.id}
                      variant="ghost"
                      size="sm"
                      aria-pressed={isSelected}
                      className={cn(
                        'h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors',
                        isSelected ? 'border-neon-cyan/30 bg-neon-cyan/10 text-cyan-300'
                          : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:border-[var(--border-strong)]',
                      )}
                      onClick={() => handleToggleTestChannel(ch.id)}
                    >
                      <Icons.notifications className="h-3 w-3" aria-hidden="true" />
                      {ch.name} ({t(`notifications.alertStudio.channels.kind.${ch.kind}`, ch.kind)})
                    </UiButton>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Icons.notificationsMuted className="h-8 w-8 text-[var(--text-muted)]" />}
              title={t('notifications.alertStudio.channels.emptyTitle', 'No external channels configured')}
              message={t('notifications.alertStudio.channels.emptyDescription', 'Browser toasts and alert history are always enabled. Configure channels from notifications to fan out alerts.')}
            />
          )}
        </GlassPanel>
      </div>
    </div>
  )
}
