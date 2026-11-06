import { Shield } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIRouteCatalog } from './FleetAPIRouteCatalog';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIEndpointControls({ controller }: Props) {
  const { t, pollingQuery, pollingState, pollingConfig, catalog } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<FadeIn delay={0.2}>
        <LayoutCard title={t('fleetApi.controls.title', 'Endpoint access')}>
          {pollingQuery.isLoading && !pollingState.hasData ? (
            <div className="space-y-3">
              <Skeleton width="30%" height={14} />
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : pollingState.fatalError ? (
            <QueryError error={pollingState.fatalError} onRetry={() => pollingQuery.refetch()} />
          ) : !pollingKnown ? (
            <EmptyState
              icon={<Shield className="h-8 w-8" />}
              message={t('fleetApi.controls.empty', 'Endpoint catalog unavailable')}
              description={t('fleetApi.controls.outdatedRuntime', 'This API server does not provide the Fleet route catalog. Update and restart the API service to manage routes; no settings can be changed here until it is available.')}
              action={{ label: t('fleetApi.controls.retry', 'Retry loading routes'), onClick: () => { void pollingQuery.refetch(); } }}
            />
          ) : (
            <FleetAPIRouteCatalog controller={controller} pollingConfig={pollingConfig} />
          )}
        </LayoutCard>
      </FadeIn>
  );
}
