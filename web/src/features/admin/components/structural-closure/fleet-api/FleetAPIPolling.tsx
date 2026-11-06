import { LayoutCard } from '@/components/layout';
import { Toggle, Text, Button, HelpTooltip } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIPolling({ controller }: Props) {
  const { t, fmtInt, settingsQuery, pollingQuery, settingsState, pollingState, suspendMut,
    pollingConfigMut, pollingConfig, pollingKnown, apiSuspended, apiStatusKnown,
    totalCount, enabledCount, autoCount } = controller;

  return (
    <FadeIn delay={0.1}>
      <LayoutCard title={t('fleetApi.polling.cardTitle', 'Tesla API')}>
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <Text weight="medium">{t('fleetApi.polling.automatic', 'Automatic polling')}</Text>
                <HelpTooltip text={t('fleetApi.polling.masterDesc', 'Off by default. Turning this off stops scheduled Fleet API reads, not manual requests or token refresh.')} />
              </div>
              {pollingConfig && (
                <Text as="p" size="sm" color="secondary">
                  {t('fleetApi.polling.scheduledReads', 'Scheduled reads only · {{state}}', {
                    state: pollingConfig.auto_polling_enabled
                      ? t('fleetApi.polling.on', 'On') : t('fleetApi.polling.off', 'Off'),
                  })}
                </Text>
              )}
            </div>
            <div className="flex w-32 shrink-0 justify-center">
              {pollingQuery.isLoading && !pollingState.hasData ? <Skeleton width="44px" height={24} />
                : pollingKnown && pollingConfig ? (
                  <Toggle checked={pollingConfig.auto_polling_enabled}
                    onChange={() => pollingConfigMut.mutate({ ...pollingConfig, auto_polling_enabled: !pollingConfig.auto_polling_enabled })}
                    aria-label={t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')}
                    disabled={pollingConfigMut.isPending} />
                ) : null}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 border-t border-[var(--border-subtle)] pt-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <Text weight="medium">{t('fleetApi.polling.actions', 'API actions')}</Text>
                <HelpTooltip text={t('fleetApi.polling.actionsHelp', 'Suspension blocks supported live requests and commands. Token refresh continues.')} />
              </div>
              <Text as="p" size="sm" color="secondary" className={apiSuspended ? 'text-[var(--semantic-danger)]' : undefined}>
                {!apiStatusKnown ? t('fleetApi.apiUnknown', 'API status unknown')
                  : apiSuspended
                    ? t('fleetApi.polling.suspendedState', 'Suspended — live requests and commands are blocked; token refresh continues.')
                    : t('fleetApi.polling.allowedState', 'Allowed')}
              </Text>
            </div>
            <div className="flex w-32 shrink-0 justify-center">
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

          {pollingState.fatalError ? (
            <QueryError error={pollingState.fatalError} onRetry={() => pollingQuery.refetch()} />
          ) : !pollingQuery.isLoading && !pollingConfig ? (
            <Text as="p" size="sm" color="secondary">{t('fleetApi.controls.empty', 'Endpoint catalog unavailable')}</Text>
          ) : pollingKnown ? (
            <Text as="p" size="sm" color="muted">
              {t('fleetApi.counts', '{{enabled}} of {{total}} endpoints allowed · {{auto}} auto-polled', {
                total: fmtInt(totalCount), enabled: fmtInt(enabledCount), auto: fmtInt(autoCount),
              })}
            </Text>
          ) : null}
          {settingsState.fatalError && <QueryError error={settingsState.fatalError} onRetry={() => settingsQuery.refetch()} />}
        </div>
      </LayoutCard>
    </FadeIn>
  );
}
