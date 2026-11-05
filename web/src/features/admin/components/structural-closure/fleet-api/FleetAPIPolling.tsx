import { AlertTriangle, Pause, Play } from 'lucide-react';
import { GlassPanel, IconBox, Toggle, PanelTitle, Text, Badge, Button, HelpTooltip } from '@/components/ui';
import { Skeleton, QueryError, InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIRouteActions } from './FleetAPIRouteActions';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIPolling({ controller }: Props) {
  const { t, fmtInt, settingsQuery, pollingQuery, settingsState, pollingState, suspendMut, pollingConfigMut, pollingConfig, catalog, apiSuspended, apiStatusKnown, totalCount, enabledCount, autoCount } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<FadeIn delay={0.1}>
        <section>
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox color={pollingConfig?.auto_polling_enabled ? 'green' : 'blue'}>
                  {pollingConfig?.auto_polling_enabled ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                </IconBox>
                <div className="flex min-w-0 items-center gap-1">
                  <PanelTitle>{t('fleetApi.polling.title', 'Tesla API polling')}</PanelTitle>
                  <HelpTooltip text={t('fleetApi.polling.masterDesc', 'Off by default. Turning this off stops scheduled Fleet API reads, not manual requests or token refresh.')} />
                </div>
              </div>
              {pollingKnown && (
                <Toggle
                  checked={pollingConfig.auto_polling_enabled}
                  onChange={() => pollingConfigMut.mutate({ ...pollingConfig, auto_polling_enabled: !pollingConfig.auto_polling_enabled })}
                  aria-label={t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')}
                  disabled={pollingConfigMut.isPending}
                />
              )}
              <Badge variant={!apiStatusKnown ? 'neutral' : apiSuspended ? 'danger' : 'success'}>
                {!apiStatusKnown ? t('fleetApi.apiUnknown', 'API status unknown')
                  : apiSuspended ? t('fleetApi.apiSuspended', 'API suspended') : t('fleetApi.apiAllowed', 'API allowed')}
              </Badge>
            </div>

            {pollingQuery.isLoading && !pollingState.hasData ? (
              <Skeleton height={56} />
            ) : pollingState.fatalError ? (
              <QueryError error={pollingState.fatalError} onRetry={() => pollingQuery.refetch()} />
            ) : !pollingConfig ? (
              <Text as="p" size="sm" color="secondary">{t('fleetApi.controls.empty', 'Endpoint catalog unavailable')}</Text>
            ) : pollingKnown ? (
              <Text as="p" size="sm" color="secondary">
                {t('fleetApi.counts', '{{total}} endpoints · {{enabled}} enabled · {{auto}} selected for auto-poll', {
                  total: fmtInt(totalCount), enabled: fmtInt(enabledCount), auto: fmtInt(autoCount),
                })}
              </Text>
            ) : null}
            <FleetAPIRouteActions controller={controller} />
            {settingsState.fatalError ? (
              <QueryError error={settingsState.fatalError} onRetry={() => settingsQuery.refetch()} />
            ) : apiSuspended ? (
              <div className="flex flex-wrap items-center gap-3">
                <InlineCallout variant="danger" icon={<AlertTriangle />}>
                  {t('fleetApi.polling.emergencyNote', 'API actions were suspended previously; supported live requests and commands are blocked. Token refresh continues.')}
                </InlineCallout>
                <Button variant="secondary" size="sm" disabled={suspendMut.isPending}
                  className="h-11 min-h-11 min-w-11 md:h-9 md:min-h-0 md:min-w-0"
                  onClick={() => suspendMut.mutate(false)}>
                  {t('fleetApi.polling.resumeActions', 'Resume API actions')}
                </Button>
              </div>
            ) : null}
          </GlassPanel>

        </section>
      </FadeIn>
  );
}
