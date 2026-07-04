/**
 * TeslaFeatureFlagsPage — first-class page for the Tesla account feature-config
 * surface (feature flags returned by Tesla's `/users/feature_config`). Promoted
 * out of /settings so it has a stable URL and is discoverable from the sidebar
 * and command palette.
 *
 * Modern-UI redesign: a full-width Fleet-Intelligence-style dashboard built
 * entirely from the shared component system —
 *   1. KPI band (total / enabled / disabled / enabled rate),
 *   2. overview bento (enabled-rate gauge + enabled-vs-disabled composition),
 *   3. full-width searchable/filterable feature table.
 * Each section owns its loading / empty / error state; the header exposes a
 * data-freshness chip and a Refresh action that re-pulls from Tesla.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { useTeslaFeatureConfig, useRefreshTeslaFeatureConfig } from '@/api/hooks/useUser';

import {
  FeatureConfigKpis,
  FeatureConfigDistribution,
  FeatureConfigComposition,
  FeatureConfigTable,
  parseFeatureEntries,
  summarizeFeatureEntries,
  buildFeatureComposition,
} from '../components/tesla-feature-flags';

export default function TeslaFeatureFlagsPage() {
  const { t } = useTranslation();
  const title = t('featureConfig.title', 'Feature Flags');
  usePageTitle(title);

  const featureQuery = useTeslaFeatureConfig();
  const refresh = useRefreshTeslaFeatureConfig();

  const { data: envelope, isLoading, isError, error, refetch } = featureQuery;

  const entries = useMemo(() => parseFeatureEntries(envelope?.data), [envelope?.data]);
  const summary = useMemo(() => summarizeFeatureEntries(entries), [entries]);
  const composition = useMemo(() => buildFeatureComposition(entries), [entries]);
  const fetchedAt = envelope?.fetched_at ?? null;

  // Only surface a blocking error panel when there is no data to fall back on.
  // A failed background refetch keeps the last-good data visible; the header
  // freshness chip + refresh toast already communicate the failure.
  const sectionError = isError && entries.length === 0 ? error : null;

  const actions = (
    <Button
      variant="secondary"
      size="sm"
      icon={<RefreshCw className={cn('h-4 w-4', refresh.isPending && 'animate-spin')} aria-hidden="true" />}
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
    >
      {t('featureConfig.refresh', 'Refresh')}
    </Button>
  );

  return (
    <PageContainer
      title={title}
      subtitle={t('featureConfig.subtitle', 'Tesla account feature configuration')}
      actions={actions}
      query={featureQuery}
    >
      <FadeIn>
        <section aria-label={t('featureConfig.kpi.bandLabel', 'Feature summary metrics')}>
          <FeatureConfigKpis summary={summary} isLoading={isLoading} error={sectionError} />
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section
          aria-label={t('featureConfig.overviewLabel', 'Feature overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="xl:col-span-1">
            <FeatureConfigDistribution
              summary={summary}
              fetchedAt={fetchedAt}
              isLoading={isLoading}
              error={sectionError}
              onRetry={refetch}
            />
          </div>
          <div className="xl:col-span-2">
            <FeatureConfigComposition
              composition={composition}
              isLoading={isLoading}
              error={sectionError}
              onRetry={refetch}
            />
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <FeatureConfigTable
          entries={entries}
          isLoading={isLoading}
          error={sectionError}
          onRetry={refetch}
        />
      </FadeIn>
    </PageContainer>
  );
}
