import { AlertTriangle, Pause, Play } from 'lucide-react';
import { GlassPanel, IconBox, Toggle, PanelTitle, Text, HelperText, Button } from '@/components/ui';
import { Skeleton, QueryError, InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIPolling({ controller }: Props) {
  const { t, settingsQuery, pollingQuery, settingsState, pollingState, suspendMut, pollingConfigMut, pollingConfig, catalog, apiSuspended } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<FadeIn delay={0.1}>
        <section>
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox color={pollingConfig?.auto_polling_enabled ? 'green' : 'blue'}>
                  {pollingConfig?.auto_polling_enabled ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                </IconBox>
                <div className="min-w-0">
                  <PanelTitle>{t('fleetApi.polling.title', 'Tesla API polling')}</PanelTitle>
                  <HelperText className="mt-0.5">
                    {t('fleetApi.polling.masterDesc', 'Off by default. Turning this off stops scheduled Fleet API reads, not manual requests or token refresh.')}
                  </HelperText>
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
            </div>

            {pollingQuery.isLoading && !pollingState.hasData ? (
              <Skeleton height={56} />
            ) : pollingState.fatalError ? (
              <QueryError error={pollingState.fatalError} onRetry={() => pollingQuery.refetch()} />
            ) : !pollingConfig ? (
              <Text as="p" size="sm" color="secondary">{t('fleetApi.controls.empty', 'Endpoint settings are unavailable.')}</Text>
            ) : pollingConfig.auto_polling_enabled ? (
              <InlineCallout variant="success" icon={<Play />}>
                {t('fleetApi.polling.activeNote', 'Only enabled routes selected for auto-polling participate. On-demand routes and commands remain independent.')}
              </InlineCallout>
            ) : (
              <InlineCallout variant="info" icon={<Pause />}>
                {t('fleetApi.polling.suspendedNote', 'Automatic Fleet API polling is off. Enabled endpoints still work on demand; token refresh continues.')}
              </InlineCallout>
            )}
            {settingsState.fatalError ? (
              <QueryError error={settingsState.fatalError} onRetry={() => settingsQuery.refetch()} />
            ) : apiSuspended ? (
              <div className="flex flex-wrap items-center gap-3">
                <InlineCallout variant="danger" icon={<AlertTriangle />}>
                  {t('fleetApi.polling.emergencyNote', 'API actions were suspended previously; supported live requests and commands are blocked. Token refresh continues.')}
                </InlineCallout>
                <Button variant="secondary" size="sm" disabled={suspendMut.isPending}
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
