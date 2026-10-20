import { Pause, Play, Shield } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPISummary({ controller }: Props) {
  const { fmtInt, t, pollingConfig, catalog, totalCount, enabledCount, autoCount, apiSuspended, kpiLoading, EM_DASH, apiStatusKnown } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<FadeIn>
        <section
          aria-label={t('fleetApi.kpis.label', 'Fleet API summary')}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {kpiLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <GlassPanel key={i} className="p-4">
                <Skeleton width="55%" height={12} />
                <Skeleton width="70%" height={28} className="mt-2" />
              </GlassPanel>
            ))
          ) : (
            <>
              <MetricCard
                label={t('fleetApi.kpis.apiStatus', 'API status')}
                value={apiStatusKnown && pollingKnown
                  ? (apiSuspended ? t('fleetApi.status.suspended', 'Suspended') : pollingConfig.auto_polling_enabled
                    ? t('fleetApi.status.polling', 'Polling enabled') : t('fleetApi.status.onDemand', 'On demand only'))
                  : EM_DASH}
                icon={apiStatusKnown && apiSuspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                color={!apiStatusKnown || !pollingKnown ? 'blue' : apiSuspended ? 'red' : 'green'}
                subtitle={t('fleetApi.kpis.apiStatusHint', 'Automatic Fleet API polling')}
              />
              <MetricCard
                label={t('fleetApi.kpis.endpointsEnabled', 'Endpoints enabled')}
                value={pollingKnown ? `${fmtInt(enabledCount)} / ${fmtInt(totalCount)}` : EM_DASH}
                icon={<Shield className="h-5 w-5" />}
                color="cyan"
                subtitle={pollingKnown ? t('fleetApi.kpis.endpointsHint', '{{count}} selected for polling', { count: autoCount }) : EM_DASH}
              />
            </>
          )}
        </section>
      </FadeIn>
  );
}
