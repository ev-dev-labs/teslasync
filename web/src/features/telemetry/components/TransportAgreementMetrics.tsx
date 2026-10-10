import { useTranslation } from 'react-i18next';
import {
  CircleHelp,
  GitCompareArrows,
  TriangleAlert,
} from 'lucide-react';

import type { TransportAgreementResponse } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';
import { AlertBanner, EmptyState } from '@/components/feedback';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface TransportAgreementMetricsProps {
  data: TransportAgreementResponse;
  retained?: boolean;
}

export function TransportAgreementMetrics({ data, retained = false }: TransportAgreementMetricsProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const measured = data.status === 'measured' && data.agreement_pct != null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'agreement', rawValue: measured ? data.agreement_pct : null,
      label: t('signalTransportAgreement.agreement', 'Agreement'),
      missingReason: measured ? undefined : t('common.notAvailable', 'N/A'),
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
      description: t('signalTransportAgreement.sourceTimeOnly', 'Producer time only; receipt fallbacks excluded'),
      context: t('telemetry.brief.transportPairCounts', 'Across comparable pairs: {{agreeing}} agreeing · {{disagreeing}} disagreeing', {
        agreeing: data.agreeing_pairs, disagreeing: data.disagreeing_pairs,
      }) },
    { metricId: 'count', occurrenceId: 'pairs', rawValue: data.comparable_pairs,
      label: t('signalTransportAgreement.comparablePairs', 'Comparable pairs'),
      display: { formatter: (raw) => ({ value: fmtInt(raw), unit: '' }) },
      description: t('signalTransportAgreement.pairTolerance', 'Within {{seconds}} seconds', {
        seconds: data.pair_tolerance_ms / 1000,
      }) },
    ...([
      ['http', 'signalTransportAgreement.httpEvidence', 'HTTP evidence', data.http_evidence_rows],
      ['mqtt', 'signalTransportAgreement.mqttEvidence', 'MQTT evidence', data.mqtt_evidence_rows],
    ] as const).map(([key, labelKey, label, raw]): StatMetric => ({
      metricId: 'count', occurrenceId: key, rawValue: raw,
      label: t(labelKey, label),
      display: { formatter: (value) => ({ value: fmtInt(value), unit: '' }) },
      description: key === 'http'
        ? t('telemetry.brief.httpRows', 'Eligible HTTP observations in the bounded producer-time evidence window.')
        : t('telemetry.brief.mqttRows', 'Eligible MQTT observations in the bounded producer-time evidence window.'),
    })),
  ];

  return (
    <>
      {data.truncated ? (
        <AlertBanner
          variant="warning"
          icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
          title={t('signalTransportAgreement.partialTitle', 'Partial evidence window')}
        >
          {t(
            'signalTransportAgreement.partialDescription',
            'The audit reached its {{limit}}-row safety limit. Results describe only the bounded sample and do not prove full-window agreement.',
            { limit: fmtInt(data.row_limit) },
          )}
        </AlertBanner>
      ) : null}

      {data.invalid_value_rows > 0 ? (
        <AlertBanner variant="warning" icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}>
          {t(
            'signalTransportAgreement.invalidRows',
            'Excluded malformed typed rows: {{count}}.',
            { count: data.invalid_value_rows },
          )}
        </AlertBanner>
      ) : null}

      <TelemetrySummaryBrief title={t('telemetry.brief.transportTitle', 'Cross-transport evidence summary')}
        metrics={metrics} testId="transport-agreement-summary" retained={retained}
        statusLabel={measured ? t('signalTransportAgreement.measured', 'Measured') : t('signalTransportAgreement.notMeasured', 'Not measured')}
        scope={`${data.from} → ${data.to}`}
        freshness={t('telemetry.brief.auditGenerated', 'Audit generated: {{timestamp}}', { timestamp: data.generated_at })}
        provenance={t('signalTransportAgreement.description', 'Compares only SI-normalized observations with producer timestamps from both Fleet Telemetry transports.')}
        description={data.truncated
          ? t('signalTransportAgreement.partialDescription', 'The audit reached its {{limit}}-row safety limit. Results describe only the bounded sample and do not prove full-window agreement.', { limit: fmtInt(data.row_limit) })
          : t('telemetry.brief.transportScope', 'Agreement describes eligible producer-time evidence in this submitted window; missing overlap is unknown, not zero agreement.')} />

      {data.status === 'no_evidence' ? (
        <EmptyState /* no-action: eligible transport evidence is recorded automatically as telemetry arrives. */
          icon={<CircleHelp className="h-8 w-8" aria-hidden="true" />}
          title={t('signalTransportAgreement.noEvidenceTitle', 'No eligible evidence')}
          message={t(
            'signalTransportAgreement.noEvidenceDescription',
            'No normalized observations with producer timestamps were recorded in this window.',
          )}
          className="py-8"
        />
      ) : data.status === 'insufficient_overlap' ? (
        <EmptyState /* no-action: overlap depends on recorded transport evidence and the parent time-window controls. */
          icon={<GitCompareArrows className="h-8 w-8" aria-hidden="true" />}
          title={t('signalTransportAgreement.overlapTitle', 'Not enough overlapping evidence')}
          message={t(
            'signalTransportAgreement.overlapDescription',
            'Agreement needs HTTP and MQTT observations for the same signal within the source-time tolerance. Missing overlap is unknown, not 0% agreement.',
          )}
          className="py-8"
        />
      ) : null}
    </>
  );
}
