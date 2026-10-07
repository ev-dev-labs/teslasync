import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatPeriod } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import type { DataQualityFieldScore, NormalizationSummary } from '@/types/admin-operator-confidence';
import { useCoverageKpis } from '../data-quality/coverageKpis';
import type { SectionState } from '../data-quality/helpers';
import { normalizationMetrics } from '../statstrip-api-quality/normalizationMetrics';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceBriefStatus } from '../statstrip-api-quality/sourceBriefStatus';
import type { DataStatus } from '@/api/dataState';

interface Props extends SectionState {
  normalization: NormalizationSummary | undefined;
  fields: readonly DataQualityFieldScore[];
  windowMins: number | undefined;
  hasSnapshot?: boolean;
  windowStart?: string;
  windowEnd?: string;
  retained?: boolean;
  sourceStatus?: DataStatus;
}

export function NormalizationCoverageKpis(props: Props) {
  const { t } = useTranslation();
  const kpis = useCoverageKpis(props.normalization, props.fields, props.windowMins, t);
  const unknown = t('admin.dataQuality.unknown', 'Unknown');
  const labels = kpis.map(kpi => ({ ...kpi,
    subtitle: kpi.key === 'total' && props.windowMins == null ? unknown
      : kpi.key === 'coverage' && !props.normalization ? unknown
        : kpi.key === 'coverage' && props.normalization?.total_sample_count === 0
          ? t('admin.dataQuality.kpiCoverageUnknownSub', 'No samples were observed in this window') : kpi.subtitle }));
  const metrics = normalizationMetrics(props.normalization, props.fields, Boolean(props.hasSnapshot), labels, unknown)
    .map((metric, index) => ({ ...metric, context: <div className="flex items-center gap-2">
      <span aria-hidden="true">{kpis[index].icon}</span>
      <Badge variant={!props.hasSnapshot || kpis[index].color === 'blue'
        || (kpis[index].key === 'coverage' && props.normalization?.total_sample_count === 0) ? 'neutral'
        : kpis[index].color === 'red' ? 'danger' : kpis[index].color === 'amber' ? 'warning'
          : kpis[index].color === 'green' ? 'success' : 'info'}>{labels[index].subtitle}</Badge>
    </div> }));
  // The scorer uses an inclusive upper bound; StatPeriod analysis is exclusively half-open.
  const period: StatPeriod = { kind: 'unknown', label: t('admin.dataQuality.summary.window', 'Scoring window'),
    reason: props.windowStart && props.windowEnd
      ? t('admin.dataQuality.summary.inclusiveWindow',
        'Server window: {{start}} through {{end}} UTC (inclusive end). Normalization totals and critical fields use this same window; no exclusive upper bound is attested.',
        { start: props.windowStart, end: props.windowEnd })
      : t('admin.dataQuality.summary.unknownBounds', 'The response has not supplied the scoring window bounds.') };
  const briefMetrics = useOperationalMetrics(metrics);
  const status = sourceBriefStatus({ status: props.sourceStatus ?? (props.error ? 'initialFailure'
    : props.retained ? 'stale' : props.hasSnapshot ? 'ok' : 'initial'), isRefreshing: false }, props.loading && !props.hasSnapshot, t);
  return (
    <section>
      {props.retained && <Text role="status">{t('developerReference.stats.state.retained', 'Showing retained measurements')}</Text>}
      <OperationalBrief testId="normalization-coverage-summary" compact
        eyebrow={t('admin.dataQuality.pageTitle', 'Data quality')}
        title={t('admin.dataQuality.kpiRegion', 'Normalization coverage totals')}
        description={period.reason ?? period.label} scope={<Text as="span" variant="caption">{period.label}</Text>}
        metrics={briefMetrics} {...status} loading={props.loading && !props.hasSnapshot} />
      {props.error ? <QueryError error={props.error} onRetry={props.onRetry} /> : null}
    </section>
  );
}
