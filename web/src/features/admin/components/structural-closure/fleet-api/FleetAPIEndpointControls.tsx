import { Shield } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { IconBox, Badge, HelperText } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIRouteActions } from './FleetAPIRouteActions';
import { FleetAPIRouteCatalog } from './FleetAPIRouteCatalog';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIEndpointControls({ controller }: Props) {
  const { t, pollingQuery, pollingState, pollingConfig, catalog, totalCount, enabledCount } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<FadeIn delay={0.2}>
        <LayoutCard title={t('fleetApi.controls.title', 'API endpoint controls')}>
          <div className="flex flex-wrap items-center gap-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0 flex-1">
              <HelperText className="mt-0.5">
                {t('fleetApi.controls.subtitle', 'Allow manual requests per endpoint, then opt supported reads into background refresh. Routes without a scheduled job stay manual only.')}
              </HelperText>
            </div>
            {pollingKnown && (
              <Badge variant="info" size="sm" className="shrink-0">
                {t('fleetApi.controls.enabledCount', '{{enabled}}/{{total}} enabled', { enabled: enabledCount, total: totalCount })}
              </Badge>
            )}
          </div>

          <FleetAPIRouteActions controller={controller} />
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
