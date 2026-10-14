import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sun, PlugZap } from 'lucide-react';

import { Badge, Button, Text } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { DataProvenanceBadge } from '@/components/data-display';
import { Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useSolarChargeAdvice } from '@/api/hooks/useEnergy';
import { useDataState } from '@/hooks/useDataState';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface SolarChargeAdviceStripProps {
  siteId?: number;
}

function verdictVariant(verdict: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (verdict) {
    case 'charge_now':
      return 'success';
    case 'charge_soon':
      return 'info';
    case 'wait':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Solar-surplus car-charging advice strip for the Power Flow status band.
 * Advice owns its query feedback independently of the live-status strip.
 */
export function SolarChargeAdviceStrip({ siteId }: SolarChargeAdviceStripProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useSolarChargeAdvice(siteId);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!siteId) return;
    // Advice is derived from this snapshot; a successful snapshot refresh
    // invalidates its model output, not recommendations for other sites.
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success'
        && event.query.queryKey[0] === 'tesla-live-status'
        && event.query.queryKey[1] === siteId) {
        void queryClient.invalidateQueries({ queryKey: ['tesla-charge-advice', siteId], exact: true });
      }
    });
  }, [queryClient, siteId]);
  // Snapshot age is evidence, not a backend-defined validity window.
  const state = useDataState(query, { provenance: 'inferred' });
  const { data } = state;
  const label = t('powerFlow.solarAdvice', 'Solar charging advice');
  const emptyMessage = t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.');
  const isLoading = !state.hasData && !!siteId
    && query.fetchStatus === 'fetching';

  return (
    <section className="min-w-0 space-y-2" aria-label={label}>
      {data && (
        <div className="flex flex-wrap items-center gap-2">
          <DataProvenanceBadge provenance={state.provenance} status={state.status} />
          {Number.isFinite(data.snapshot_age_s) && data.snapshot_age_s >= 0 && (
            <Text as="span" variant="caption" color="secondary">
              {t('sourceLayer.age', 'age')}: {t('timeMachine.ageSeconds', '{{value}}s', {
                value: fmtNumber(data.snapshot_age_s),
              })}
            </Text>
          )}
        </div>
      )}
      {state.status === 'stale' && <StaleRefreshWarning state={state} label={label} />}
      <SourceContent
        label={label}
        state={state.fatalError ? 'error' : isLoading ? 'loading'
          : !data || data.verdict === 'no_data' ? 'empty' : 'ready'}
        loadingContent={<Skeleton className="h-6 w-full max-w-sm" />}
        emptyMessage={emptyMessage}
        emptyContent={
          <div className="space-y-2">
            <Text as="p" variant="bodySm" role="status">
              {state.isRefreshBlocked && !state.hasData
                ? t('dataSources.status.paused', 'Refresh paused')
                : data?.explanation || emptyMessage}
            </Text>
            {state.isRefreshBlocked && !state.hasData && state.retry && (
              <Button type="button" variant="secondary" size="sm" onClick={state.retry}>
                {t('error.retry', 'Retry')}
              </Button>
            )}
          </div>
        }
        error={state.fatalError}
        errorMessage={t('dataSources.status.failed', 'Failed')}
        errorRecovery={{ onRetry: state.retry ?? undefined, resourceName: label }}
      >
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(data.verdict)}>
              {data.verdict === 'charge_now' ? (
                <PlugZap className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Sun className="h-3 w-3" aria-hidden="true" />
              )}
              {data.verdict === 'charge_now'
                ? t('powerFlow.chargeNow', 'Charge now on solar')
                : data.verdict === 'charge_soon'
                  ? t('powerFlow.chargeSoon', 'Charge soon')
                  : t('powerFlow.chargeWait', 'Hold for cheap rates')}
            </Badge>
            <Text as="span" variant="caption" className="tabular-nums">
              {t('powerFlow.surplus', '{{kw}} kW surplus · ~{{amps}}A solar-matched', {
                kw: fmtNumber(data.surplus_w / 1000),
                amps: data.recommended_amps,
              })}
            </Text>
            {data.explanation && <Text as="span" variant="bodySm" color="secondary">{data.explanation}</Text>}
          </div>
        )}
      </SourceContent>
    </section>
  );
}
