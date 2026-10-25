import { Icons } from '@/lib/icons';
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

import { PageLayout } from '@/components/layout';
import { Icon, HelperText, IconButton } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTeslaFeatureConfig, useRefreshTeslaFeatureConfig } from '@/api/hooks/useUser';
import { deriveDataState } from '@/api/dataState';
import { useOperationalMode } from '@/hooks/useOperationalMode';

import {
  FeatureConfigDistribution,
  FeatureConfigComposition,
  FeatureConfigTable,
  parseFeatureEntries,
  summarizeFeatureEntries,
  buildFeatureComposition,
} from '../components/tesla-feature-flags';
import { FeatureConfigOperationalBrief } from '../components/statstrip-tesla-account-privacy/FeatureConfigOperationalBrief';

export default function TeslaFeatureFlagsPage() {
  const { t } = useTranslation();
  const title = t('featureConfig.title', 'Feature flags');
  usePageTitle(title);

  const featureQuery = useTeslaFeatureConfig();
  const refresh = useRefreshTeslaFeatureConfig();
  const { canWrite, writeBlockReason } = useOperationalMode();

  const { data: envelope, refetch } = featureQuery;
  const source = deriveDataState(featureQuery);
  const isLoading = source.status === 'initial';

  const entries = useMemo(() => parseFeatureEntries(envelope?.data), [envelope?.data]);
  const summary = useMemo(() => summarizeFeatureEntries(entries), [entries]);
  const composition = useMemo(() => buildFeatureComposition(entries), [entries]);
  const fetchedAt = envelope?.fetched_at ?? null;

  // Only surface a blocking error panel when there is no data to fall back on.
  // A failed background refetch keeps the last-good data visible; the header
  // freshness chip + refresh toast already communicate the failure.
  const sectionError = source.fatalError;

  const actions = (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <IconButton icon={<Icon icon={Icons.refresh} />} label={t('featureConfig.refresh', 'Refresh')} onClick={() => canWrite && !refresh.isPending && refresh.mutate()} busy={refresh.isPending} disabled={!canWrite || refresh.isPending} aria-describedby={writeBlockReason ? 'tesla-feature-refresh-reason' : undefined} />
      {writeBlockReason && (
        <HelperText id="tesla-feature-refresh-reason">{writeBlockReason}</HelperText>
      )}
    </div>
  );

  return (
    <PageLayout
      title={title}
      subtitle={t('featureConfig.subtitle', 'Tesla account feature configuration')}
      secondaryActions={actions}
      query={featureQuery}
      dataSources={[{
        id: 'tesla-feature-config',
        label: t('featureConfig.title', 'Feature flags'),
        query: featureQuery,
      }]}
    >
      <FadeIn>
        <section aria-label={t('featureConfig.kpi.bandLabel', 'Feature summary metrics')}>
          <FeatureConfigOperationalBrief summary={source.hasData && envelope?.data != null ? summary : null}
            fetchedAt={fetchedAt} loading={source.status === 'initial'}
            sourceStatus={source.status} />
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
    </PageLayout>
  );
}
