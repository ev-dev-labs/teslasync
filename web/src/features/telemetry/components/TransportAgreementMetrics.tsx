import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  CircleHelp,
  GitCompareArrows,
  Radio,
  Rows3,
  TriangleAlert,
  Webhook,
} from 'lucide-react';

import type { TransportAgreementResponse } from '@/api/types';
import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

export interface TransportAgreementMetricsProps {
  data: TransportAgreementResponse;
}

export function TransportAgreementMetrics({ data }: TransportAgreementMetricsProps) {
  const { t } = useTranslation();
  const measured = data.status === 'measured' && data.agreement_pct != null;

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t('signalTransportAgreement.agreement', 'Agreement')}
          value={measured ? fmtPercent(data.agreement_pct, 1) : t('common.notAvailable', 'N/A')}
          subtitle={t(
            'signalTransportAgreement.sourceTimeOnly',
            'Producer time only; receipt fallbacks excluded',
          )}
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          color={measured && data.disagreeing_pairs === 0 ? 'green' : 'amber'}
        />
        <MetricCard
          label={t('signalTransportAgreement.comparablePairs', 'Comparable pairs')}
          value={fmtInt(data.comparable_pairs)}
          subtitle={t(
            'signalTransportAgreement.pairTolerance',
            'Within {{seconds}} seconds',
            { seconds: data.pair_tolerance_ms / 1000 },
          )}
          icon={<Rows3 className="h-5 w-5" aria-hidden="true" />}
          color="blue"
        />
        <MetricCard
          label={t('signalTransportAgreement.httpEvidence', 'HTTP evidence')}
          value={fmtInt(data.http_evidence_rows)}
          icon={<Webhook className="h-5 w-5" aria-hidden="true" />}
          color="purple"
        />
        <MetricCard
          label={t('signalTransportAgreement.mqttEvidence', 'MQTT evidence')}
          value={fmtInt(data.mqtt_evidence_rows)}
          icon={<Radio className="h-5 w-5" aria-hidden="true" />}
          color="cyan"
        />
      </div>

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
