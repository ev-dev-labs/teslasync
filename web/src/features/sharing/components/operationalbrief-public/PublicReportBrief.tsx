import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import { usePublicOperationalMetrics } from '@/hooks/usePublicOperationalMetrics';

export interface PublicReportEvidence {
  readonly field: string;
  readonly value: number | null | undefined;
  readonly unit: string;
}

interface Props {
  readonly title: string;
  readonly description: string;
  readonly eventDate: string;
  readonly source: string;
  readonly metrics: readonly StatMetric[];
  readonly preferences: MetricPreferences;
  readonly evidence: readonly PublicReportEvidence[];
  readonly testId: string;
}

export function PublicReportBrief({
  title, description, eventDate, source, metrics, preferences, evidence, testId,
}: Props) {
  const { t } = useTranslation();
  const values = usePublicOperationalMetrics(metrics, preferences);
  const limitation = t('share.publicBrief.limitations', 'Only measurements included by the owner are shown. An omitted measurement is not a measured zero.');
  const eventContext = eventDate
    ? t('share.publicBrief.eventContext', 'Report event date: {{date}}', { date: eventDate })
    : undefined;
  return (
    <OperationalBrief
      compact
      testId={testId}
      eyebrow={t('share.publicBrief.eyebrow', 'Public report')}
      title={title}
      description={description}
      metrics={values}
      statusLabel={t('share.publicBrief.status', 'Owner-shared measurements')}
      scope={t('share.publicBrief.scope', 'Owner-selected event; no workspace range or vehicle filter.')}
      freshness={t('share.publicBrief.eventDate', 'The report date describes the event, not data freshness.')}
      provenance={source}
      narrative={{
        whatChanged: description,
        whyItMatters: null,
        confidence: { label: 'not_scored', score: null, basis: [] },
        likelyCause: null,
        recommendedResponse: null,
        limitations: [limitation],
        evidence: evidence.filter(row => row.value != null).map(row => ({
          id: row.field,
          summary: t('share.publicBrief.rawMeasurement', '{{field}}: {{value}} {{unit}}', {
            field: row.field, value: String(row.value), unit: row.unit,
          }).trim(),
          observedAt: null,
          provenance: { source, method: eventContext },
        })),
        provenance: [{ source, method: eventContext }],
      }}
    />
  );
}
