import { LayoutCard } from '@/components/layout';
import { Badge, Toggle, Text, Button, HelpTooltip } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIPolling({ controller }: Props) {
  const { t, fmtInt, settingsQuery, pollingQuery, settingsState, pollingState, suspendMut,
    pollingConfigMut, pollingConfig, pollingKnown, apiSuspended, apiStatusKnown,
    totalCount, enabledCount, autoCount, smartCount } = controller;

  return (
    <FadeIn delay={0.1}>
      <LayoutCard title={t('fleetApi.polling.cardTitle', 'Tesla API')}>
        <div className="space-y-3">
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-panel border border-[var(--border-default)] p-3">
              <div className="flex items-center gap-1">
                <Text weight="medium">{t('fleetApi.polling.automatic', 'Automatic polling')}</Text>
                <HelpTooltip text={t('fleetApi.polling.masterDesc', 'Off by default. Turning this off stops scheduled Fleet API reads, not manual requests or token refresh.')} />
              </div>
              {pollingConfig && (
                <Badge variant={pollingConfig.auto_polling_enabled && apiStatusKnown && !apiSuspended ? 'success' : 'neutral'}>
                  {pollingConfig.auto_polling_enabled
                    ? apiSuspended ? t('fleetApi.redesign.paused', 'Paused') : t('fleetApi.polling.on', 'On')
                    : t('fleetApi.redesign.paused', 'Paused')}
                </Badge>
              )}
              {pollingQuery.isLoading && !pollingState.hasData ? <Skeleton width="44px" height={24} />
                : pollingKnown && pollingConfig ? (
                  <Toggle checked={pollingConfig.auto_polling_enabled}
                    onChange={() => pollingConfigMut.mutate({ ...pollingConfig, auto_polling_enabled: !pollingConfig.auto_polling_enabled })}
                    aria-label={t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')}
                    disabled={pollingConfigMut.isPending} />
                ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-panel border border-[var(--border-default)] p-3">
              <div className="flex items-center gap-1">
                <Text weight="medium">{t('fleetApi.polling.actions', 'API actions')}</Text>
                <HelpTooltip text={t('fleetApi.polling.actionsHelp', 'Suspension blocks supported live requests and commands. Token refresh continues.')} />
              </div>
              <Badge variant={!apiStatusKnown ? 'neutral' : apiSuspended ? 'warning' : 'success'}>
                {!apiStatusKnown ? t('fleetApi.apiUnknown', 'API status unknown')
                  : apiSuspended
                    ? t('fleetApi.polling.suspendedLabel', 'Suspended')
                    : t('fleetApi.polling.allowedState', 'Allowed')}
              </Badge>
              {apiSuspended && !settingsState.fatalError && (
                <Button variant="secondary" size="sm" disabled={suspendMut.isPending}
                  className="h-11 min-h-11 min-w-11 md:h-9 md:min-h-0 md:min-w-0"
                  aria-label={t('fleetApi.polling.resumeActions', 'Resume API actions')}
                  onClick={() => suspendMut.mutate(false)}>
                  {t('fleetApi.polling.resume', 'Resume')}
                </Button>
              )}
            </div>
          </div>
          {apiSuspended && <Text as="p" size="sm" color="secondary" className="text-[var(--semantic-danger)]">
            {t('fleetApi.polling.suspensionHelp', 'Live requests and commands are blocked; token refresh continues.')}
          </Text>}
          {pollingState.fatalError ? (
            <QueryError error={pollingState.fatalError} onRetry={() => pollingQuery.refetch()} />
          ) : !pollingQuery.isLoading && !pollingConfig ? (
            <Text as="p" size="sm" color="secondary">{t('fleetApi.controls.empty', 'Endpoint catalog unavailable')}</Text>
          ) : pollingKnown ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              <Badge variant="info">{t('fleetApi.redesign.accessCount', 'Access: {{enabled}} of {{total}}', {
                total: fmtInt(totalCount), enabled: fmtInt(enabledCount),
              })}</Badge>
              {pollingConfig?.smart_endpoints != null && <Badge variant="neutral">
                {t('fleetApi.redesign.smartCount', 'Smart Features: {{total}} allowed', { total: fmtInt(smartCount) })}
              </Badge>}
              <Badge variant="neutral">{t('fleetApi.redesign.autoCount', 'Auto-poll: {{total}} selected', { total: fmtInt(autoCount) })}</Badge>
            </div>
          ) : null}
          {settingsState.fatalError && <QueryError error={settingsState.fatalError} onRetry={() => settingsQuery.refetch()} />}
        </div>
      </LayoutCard>
    </FadeIn>
  );
}
