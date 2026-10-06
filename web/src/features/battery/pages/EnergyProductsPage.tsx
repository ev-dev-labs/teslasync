import { useTranslation } from 'react-i18next';
import { Zap, RefreshCw } from 'lucide-react';
import { CardGrid, LayoutCard, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { safeArray } from '@/lib/safeArray';
import { useTeslaEnergySites, useRefreshTeslaEnergySites } from '@/api/hooks/useEnergy';
import { SummaryBand } from '../components/energy-products-modernization/SummaryBand';
import { EnergySiteCard } from '../components/energy-products-modernization/EnergySiteCard';
import { SourceTrustNotice } from '../components/projected-range-modernization/SourceTrustNotice';

export { fmtEnergy, fmtPower, resourceIcon, resourceLabel, operationModeLabel } from '../components/energy-products-modernization/helpers';

export default function EnergyProductsPage() {
  const { t } = useTranslation();
  usePageTitle(t('energy.products.title', 'Energy Products'));
  const sitesQuery = useTeslaEnergySites();
  const source = useDataState(sitesQuery);
  const refreshMutation = useRefreshTeslaEnergySites();
  const sites = safeArray(source.data);
  const loading = sitesQuery.isLoading && !source.hasData;
  const retained = source.status === 'stale';

  return (
    <PageLayout
      title={t('energy.products.title', 'Energy Products')}
      subtitle={t('energy.products.subtitle', 'Powerwalls, Solar Panels & Wall Connectors discovered from Tesla')}
      query={sitesQuery}
      primaryAction={<Button onClick={() => refreshMutation.mutate()}
        loading={refreshMutation.isPending} disabled={refreshMutation.isPending}
        aria-label={t('energy.products.refresh', 'Refresh from Tesla')}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('energy.products.refresh', 'Refresh from Tesla')}
      </Button>}
    >
      <SourceTrustNotice source={source} label={t('energy.products.title', 'Energy Products')} />
      <FadeIn>
        {source.fatalError ? (
          <LayoutCard title={t('energy.products.summary', 'Energy summary')}>
            <QueryError error={source.fatalError} onRetry={() => sitesQuery.refetch()} />
          </LayoutCard>
        ) : <SummaryBand sites={sites} isLoading={loading} retained={retained} hasData={source.hasData} />}
      </FadeIn>
      <FadeIn delay={0.05}>
        {loading ? (
          <CardGrid label={t('energy.products.title', 'Energy Products')} items={[0, 1].map(index => ({
            id: `loading-site-${index}`, size: 'half',
            content: <LayoutCard title={t('energy.siteInfo.title', 'Site Configuration')}>
              <Skeleton className="h-72 rounded-xl" />
            </LayoutCard>,
          }))} />
        ) : sites.length > 0 ? (
          <CardGrid label={t('energy.products.title', 'Energy Products')} items={sites.map(site => ({
            id: String(site.id), size: 'half',
            content: <EnergySiteCard site={site} retained={retained} />,
          }))} />
        ) : (
          <LayoutCard title={t('energy.products.title', 'Energy Products')}>
            {/* no-action: The page's Refresh from Tesla action above owns site discovery. */}
            <EmptyState icon={<Zap className="h-8 w-8" />}
              message={source.fatalError
                ? t('energy.products.modernization.unavailable', 'Energy site discovery is unavailable. Retry above or refresh from Tesla.')
                : !source.hasData
                  ? t('energy.products.modernization.noSnapshot', 'No energy-site snapshot has loaded. Refresh from Tesla to discover your installations.')
                  : t('energy.products.empty', 'No energy products found. Use "Refresh from Tesla" to discover your Powerwalls and Solar installations.')} />
          </LayoutCard>
        )}
      </FadeIn>
    </PageLayout>
  );
}
