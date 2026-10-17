import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { CarbonSectionBody } from '../carbon-intelligence/CarbonSectionBody';
import type { CarbonQueryState } from '../carbon-intelligence/types';

export function CarbonBriefBand({ testId, title, description, scope, state, metrics, children }: {
  testId: string; title: string; description: string; scope: ReactNode;
  state: CarbonQueryState; metrics: readonly StatMetric[]; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  return <section data-testid={testId}>
    <OperationalBrief compact metrics={operationalMetrics} loading={state.isLoading && !state.hasData}
      eyebrow={t('carbon.title', 'Carbon intelligence')} title={title} description={description}
      scope={scope} provenance={description}
      statusLabel={state.isLoading && !state.hasData ? t('analytics.brief.loading', 'Loading evidence')
        : !state.hasData ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : state.refreshError || state.refreshPaused ? t('analytics.brief.retained', 'Retained evidence')
            : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!state.hasData || state.refreshError || state.refreshPaused ? 'warning' : 'neutral'} />
    <CarbonSectionBody state={state}>{children}</CarbonSectionBody>
  </section>;
}
