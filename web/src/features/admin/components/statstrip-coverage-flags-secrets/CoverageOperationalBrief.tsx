import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { FleetTelemetryCoverageResponse } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceStatus, sourceFreshness } from './sourceMetadata';

export function coverageMetrics(data: FleetTelemetryCoverageResponse | undefined, t: TFunction): StatMetric[] {
  const categories = data?.categories ?? [];
  const fields = categories.flatMap(category => category.fields ?? []);
  const subscribed = fields.filter(field => field.subscribed).length;
  const known = data != null;
  const counts = [
    ['categories', 'coverage.stat.categories', 'Categories', categories.length],
    ['routed', 'coverage.stat.routedFields', 'Routed fields', fields.length],
    ['subscribed', 'coverage.stat.subscribed', 'Subscribed', subscribed],
    ['unsubscribed', 'coverage.stat.routedNotSubscribed', 'Routed, not subscribed', fields.length - subscribed],
    ['orphans', 'coverage.stat.orphans', 'Orphan fields', (data?.orphan_fields ?? []).length],
  ] as const;
  return [
    ...counts.map(([occurrenceId, key, fallback, value]): StatMetric => ({
      metricId: 'count', occurrenceId, rawValue: known ? value : null,
      label: t(key, fallback),
      description: t(`coverage.statstrip.${occurrenceId}Description`, {
        defaultValue: {
          categories: 'Categories in the package-derived routing catalogue.',
          routed: 'Unique fields in routing categories; dual-write destinations are not counted twice.',
          subscribed: 'Routed fields included in the current subscription configuration.',
          unsubscribed: 'Routed fields absent from the current subscription configuration.',
          orphans: 'Configured fields without a matching proto catalogue route.',
        }[occurrenceId],
      }),
    })),
    {
      metricId: 'percent', occurrenceId: 'coverage',
      rawValue: known ? (fields.length > 0 ? subscribed / fields.length * 100 : 0) : null,
      label: t('coverage.stat.subscriptionCoverage', 'Subscription coverage'),
      description: t('coverage.statstrip.coverageDescription', 'Subscribed routed fields divided by all routed fields, on a 0–100 scale. An empty routing catalogue retains the existing 0% convention.'),
      context: known ? t('coverage.statstrip.denominator', '{{subscribed}} subscribed / {{routed}} routed fields', {
        subscribed, routed: fields.length,
      }) : t('coverage.statstrip.noSnapshot', 'No routing snapshot supplied'),
    },
  ];
}

export function CoverageOperationalBrief({ query }: { query: DataStateSource<FleetTelemetryCoverageResponse> }) {
  const { t } = useTranslation();
  const { precision } = useNumberFormatting();
  const source = deriveDataState(query);
  const metrics = coverageMetrics(query.data, t).map(metric =>
    metric.metricId === 'percent' ? { ...metric, display: { precision } } : metric);
  const briefMetrics = useOperationalMetrics(metrics);
  const retained = source.hasData && (source.status === 'stale' || source.isRefreshing);
  const error = source.fatalError ?? source.refreshError;
  return <section aria-label={t('coverage.kpis', 'Coverage summary')} data-retained={retained}>
    {retained && <Text role="status">{t('operationalSource.retained', 'Showing retained measurements')}</Text>}
    {error && <Text role="alert">{error.message}</Text>}
    <OperationalBrief testId="coverage-summary" compact metrics={briefMetrics}
      loading={source.status === 'initial'}
      eyebrow={t('coverage.brief.eyebrow', 'Routing configuration')}
      title={t('coverage.brief.title', 'Fleet telemetry coverage')}
      description={t('coverage.brief.description', 'Review catalogue routes, configured subscriptions and orphan fields before inspecting the destination and field evidence below.')}
      statusLabel={sourceStatus(source.status, t)}
      statusTone={error ? 'warning' : 'neutral'}
      scope={<Text as="span" variant="caption">{t('coverage.statstrip.period', 'Package configuration snapshot')}</Text>}
      freshness={<Text as="span" variant="caption">{sourceFreshness(source.updatedAt, t)}</Text>}
      provenance={t('coverage.statstrip.provenance', 'routing.yaml and teslaconfig.Builder; not per-vehicle telemetry or a time-range aggregate.')} />
    <Text variant="caption">{t('coverage.statstrip.provenance', 'routing.yaml and teslaconfig.Builder; not per-vehicle telemetry or a time-range aggregate.')}</Text>
  </section>;
}
