import { Activity, Globe, Link as LinkIcon } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { GlassPanel, IconBox, Text, Label, Code } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIConfiguredEndpoints({ controller }: Props) {
  const { t, versionQuery, versionState, configuredEndpoints, versionLabel, configuredEndpointMap, hasConfiguredEndpoints } = controller;

  return (
<FadeIn delay={0.3}>
        <LayoutCard title={t('fleetApi.configured.title', 'API endpoints')}>
          <div className="flex flex-wrap items-center gap-3">
            <IconBox color="blue">
              <Globe className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0 flex-1">
              {versionLabel && (
                <Text as="p" size="xs" color="muted" mono className="mt-0.5 break-words">{versionLabel}</Text>
              )}
            </div>
          </div>

          {versionQuery.isLoading && !versionState.hasData ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : versionState.fatalError ? (
            <QueryError error={versionState.fatalError} onRetry={() => versionQuery.refetch()} />
          ) : !hasConfiguredEndpoints ? (
            // no-action: endpoint URLs are deployment-managed and appear after configuration plus restart.
            <EmptyState
              icon={<Activity className="h-8 w-8 opacity-40" />}
              title={t('fleetApi.configured.emptyTitle', 'Endpoint metadata unavailable')}
              message={t(
                'fleetApi.configured.emptyMessage',
                'This runtime did not publish any configured endpoint URLs.',
              )}
              description={t(
                'fleetApi.configured.emptyDescription',
                'Configure the public and Tesla Fleet API URLs in deployment settings; metadata appears after the service restarts.',
              )}
              className="py-8"
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <Label>{t('fleetApi.configured.heading', 'Configured endpoints')}</Label>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {configuredEndpoints.filter((ep) => configuredEndpointMap[ep.key]).map((ep) => (
                  <GlassPanel key={ep.key} className="min-w-0 space-y-1 p-3">
                    <Text as="span" size="xs" weight="medium" color="secondary" className="block break-words">{ep.label}</Text>
                    <Code className="block break-all" title={configuredEndpointMap[ep.key]}>{configuredEndpointMap[ep.key]}</Code>
                  </GlassPanel>
                ))}
              </div>
            </div>
          )}
        </LayoutCard>
      </FadeIn>
  );
}
