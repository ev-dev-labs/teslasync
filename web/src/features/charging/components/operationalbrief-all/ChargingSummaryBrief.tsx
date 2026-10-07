import { useTranslation } from 'react-i18next';
import { OperationalBrief, type OperationalBriefMetric, type StatStripProps } from '@/components/data-display';
import { Badge, Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface Props extends StatStripProps {
  description?: string;
  sourceStatus?: string;
  metricTones?: Readonly<Record<string, OperationalBriefMetric['tone']>>;
}

/** Charging summaries retain their independent source periods and specialist displays. */
export function ChargingSummaryBrief({
  metrics, period, preferences, title, id, testId, loading = false, retained = false,
  secondary, footer, emptyContent, className, comparisonLabel, description, sourceStatus, periodHeaderId, metricTones,
}: Props) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics, preferences);
  const available = operationalMetrics.filter(metric => metric.valueState === 'value').length;
  const context = period.kind === 'unknown' ? period.reason : period.provenance;
  const status = sourceStatus ?? (retained
    ? t('charging.brief.retained', 'Retained source measurements')
    : loading
      ? t('charging.brief.loading', 'Loading source measurements')
      : available === 0
        ? t('charging.brief.missing', 'No source measurements')
        : available < operationalMetrics.length
          ? t('charging.brief.partial', 'Some measurements unavailable')
          : t('charging.brief.available', 'Source measurements available'));
  const periodBounds = period.kind === 'analysis'
    ? `${period.start} – ${period.endExclusive} (${period.timezone})`
    : period.kind === 'event'
    ? [period.start, period.end].filter(Boolean).join(' – ')
    : period.kind === 'snapshot' ? period.observedAt : undefined;
  return (
    <div id={id} className={className} data-period-kind={period.kind}
      data-retained={retained || undefined} aria-busy={loading || undefined}>
      <OperationalBrief
        compact
        testId={testId}
        eyebrow={t('charging.brief.eyebrow', 'Charging evidence')}
        title={periodHeaderId && title
          ? t('charging.brief.evidenceFor', 'Evidence: {{title}}', { title })
          : title ?? period.label}
        description={description ?? t('charging.brief.sourceDescription',
          'Recorded measurements from the stated charging source and scope.')}
        statusLabel={status}
        statusTone={retained || (available > 0 && available < operationalMetrics.length) ? 'warning' : 'neutral'}
        loading={loading && !retained}
        metrics={metricTones
          ? operationalMetrics.map(metric => ({ ...metric, tone: metricTones[metric.key] }))
          : operationalMetrics}
        scope={<Badge variant="neutral" size="sm">{period.label}</Badge>}
        freshness={periodBounds ? <Text as="span" variant="caption">{periodBounds}</Text> : undefined}
        provenance={context ?? period.label}
        narrative={{
          whatChanged: description ?? context ?? period.label,
          whyItMatters: null,
          confidence: { label: 'not_scored', score: null, basis: [] },
          likelyCause: null,
          recommendedResponse: null,
          limitations: context ? [context] : [],
          evidence: [],
          provenance: [{ source: context ?? period.label }],
        }}
      />
      {comparisonLabel && <Text as="p" variant="caption" className="mt-2">{comparisonLabel}</Text>}
      {secondary != null && <div className="mt-3">{secondary}</div>}
      {footer != null && <div className="mt-3">{footer}</div>}
      {!loading && available === 0 && emptyContent != null && <div className="mt-3">{emptyContent}</div>}
    </div>
  );
}
