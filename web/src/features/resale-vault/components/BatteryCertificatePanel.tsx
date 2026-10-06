/**
 * Server-signed battery certificate — the shareable resale attestation.
 * Issues the signed certificate for the vehicle, renders the buyer-facing
 * snapshot, and offers one-click copies of the certificate JSON + signature
 * so the seller can paste them into a listing. A self-verification badge
 * proves the signature round-trips through the public verify endpoint.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ShieldCheck } from 'lucide-react';

import { HelperText, Badge, Button, CopyButton, ErrorText } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { KVList } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import {
  useBatteryCertificate,
  useVerifyBatteryCertificate,
} from '@/api/hooks/useBatteryCertificate';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VaultSummaryBrief } from './operationalbrief-all/VaultSummaryBrief';
import type { StatMetric } from '@/components/data-display/stat-reference/types';

export interface BatteryCertificatePanelProps {
  vehicleId: string | null;
}

export function BatteryCertificatePanel({ vehicleId }: BatteryCertificatePanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { formatEnergy } = useUnits();

  const certQuery = useBatteryCertificate(vehicleId);
  const certState = useDataState(certQuery);
  const verifyMutation = useVerifyBatteryCertificate();

  const issued = certQuery.data ?? null;
  const signature = issued?.signature ?? null;
  const lastAttempt = useRef<typeof issued>(null);

  // A previous success must not attest a newly issued certificate.
  useEffect(() => {
    if (issued && issued !== lastAttempt.current && !verifyMutation.isPending) {
      lastAttempt.current = issued;
      verifyMutation.mutate({ certificate: issued.certificate, signature: issued.signature });
    }
  }, [issued, verifyMutation]);

  const verificationMatches =
    issued != null &&
    verifyMutation.variables?.signature === issued.signature &&
    verifyMutation.variables?.certificate === issued.certificate;
  const verified = verificationMatches && !verifyMutation.isPending && !verifyMutation.isError && verifyMutation.data?.valid === true;
  const verificationFailed = verificationMatches && !verifyMutation.isPending &&
    (verifyMutation.isError || verifyMutation.data?.valid === false);
  const description = t('resaleVault.brief.certificate.description', 'Server-issued battery snapshot; signature verification is shown separately and applies only to this exact payload.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'certificate-soh', label: t('resaleVault.certificate.soh', 'State of health'), rawValue: issued?.certificate.current_soh, description },
    { metricId: 'energy', occurrenceId: 'certificate-capacity', label: t('resaleVault.certificate.capacity', 'Current capacity'), rawValue: issued ? issued.certificate.estimated_capacity_kwh * 1000 : null, description,
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'certificate-cycles', label: t('resaleVault.certificate.cycles', 'Total cycles'), rawValue: issued?.certificate.total_cycles, description, display: { notation: 'source' } },
    { metricId: 'score', occurrenceId: 'certificate-habits', label: t('resaleVault.certificate.habits', 'Charge habits score'), rawValue: issued?.certificate.charge_habits_score, description,
      display: { formatter: (raw) => ({ value: `${fmtNumber(raw)} / 100`, unit: '' }) } },
  ];

  return (
    <LayoutCard title={t('resaleVault.certificate.title', 'Battery certificate')}
      actions={<div className="flex flex-wrap items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {verified && (
          <Badge variant="success" size="sm" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('resaleVault.certificate.verified', 'Signature verified')}
          </Badge>
        )}
      </div>}
    >

      <HelperText>
        {t(
          'resaleVault.certificate.body',
          'A server-signed battery health attestation. Share the certificate and signature with a buyer — they can verify authenticity without an account.',
        )}
      </HelperText>

      <StaleRefreshWarning state={certState} label={t('resaleVault.certificate.title', 'Battery certificate')} />
      <VaultSummaryBrief id="certificate" title={t('resaleVault.brief.certificate.title', 'Certificate measurements')}
        description={description} metrics={metrics} hasEvidence={issued != null}
        sources={[{ id: 'certificate', section: 'battery', labelKey: 'resaleVault.certificate.title',
          label: 'Battery certificate', loading: !certState.hasData && certQuery.isLoading, state: certState }]}
        scope={t('resaleVault.brief.certificate.scope', 'Issued {{issued}}; expires {{expires}}', {
          issued: issued?.certificate.issued_at ?? '—', expires: issued?.certificate.expires_at ?? '—',
        })}
        provenance={issued?.certificate.issuer}
      />
      <SourceContent
        state={certState.fatalError ? 'error' : !certState.hasData && certQuery.isLoading ? 'loading' : !issued ? 'empty' : 'ready'}
        label={t('resaleVault.certificate.title', 'Battery certificate')}
        error={certState.fatalError}
        errorMessage={t('resaleVault.certificate.loadError', 'The battery certificate could not be loaded.')}
        errorRecovery={certState.retry ? { onRetry: certState.retry } : undefined}
        emptyMessage={t('resaleVault.certificate.empty', 'No certificate available for this vehicle.')}
        loadingContent={<Skeleton height={160} />}
        emptyContent={
        <EmptyState /* no-action: informational empty — no CTA */
          message={t('resaleVault.certificate.empty', 'No certificate available for this vehicle.')}
        />}
      >
        {issued ? <>
          <KVList
            items={[
              {
                label: t('resaleVault.certificate.expires', 'Valid until'),
                value: formatDate(issued.certificate.expires_at),
              },
            ]}
          />

          <div className="space-y-2 rounded-lg bg-white/[0.03] px-3 py-2">
            <HelperText className="break-all font-mono text-xs tabular-nums">
              {t('resaleVault.certificate.signature', 'Signature: {{sig}}', {
                sig: `${signature?.slice(0, 32)}…`,
              })}
            </HelperText>
            <div className="flex flex-wrap gap-2">
              <CopyButton
                text={JSON.stringify(issued.certificate)}
                label={t('resaleVault.certificate.copyCert', 'Copy certificate')}
                withToast
              />
              <CopyButton
                text={signature ?? ''}
                label={t('resaleVault.certificate.copySig', 'Copy signature')}
                withToast
              />
            </div>
          </div>

          {verificationFailed && (
            <div className="space-y-2">
              <ErrorText>
                {t('resaleVault.certificate.verifyError', 'Self-verification failed — the signature may be stale.')}
              </ErrorText>
              <Button
                wrapLabel
                size="sm"
                variant="secondary"
                onClick={() => verifyMutation.mutate({ certificate: issued.certificate, signature: issued.signature })}
              >
                {t('resaleVault.certificate.retryVerify', 'Retry verification')}
              </Button>
            </div>
          )}
        </> : null}
      </SourceContent>
    </LayoutCard>
  );
}
