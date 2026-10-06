/**
 * Server-signed battery certificate — the shareable resale attestation.
 * Issues the signed certificate for the vehicle, renders the buyer-facing
 * snapshot, and offers one-click copies of the certificate JSON + signature
 * so the seller can paste them into a listing. A self-verification badge
 * proves the signature round-trips through the public verify endpoint.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ShieldCheck } from 'lucide-react';

import { HelperText, Badge, CopyButton, ErrorText } from '@/components/ui';
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

  // Self-verify the just-issued certificate through the same public
  // endpoint a buyer would use. Runs once per signature.
  useEffect(() => {
    if (issued && !verifyMutation.isPending && verifyMutation.data === undefined && !verifyMutation.isError) {
      verifyMutation.mutate({ certificate: issued.certificate, signature: issued.signature });
    }
  }, [issued, verifyMutation]);

  const verified = verifyMutation.data?.valid === true;

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
                label: t('resaleVault.certificate.soh', 'State of health'),
                value: `${fmtNumber(issued.certificate.current_soh)}%`,
              },
              {
                label: t('resaleVault.certificate.capacity', 'Current capacity'),
                value: formatEnergy(issued.certificate.estimated_capacity_kwh * 1000),
              },
              {
                label: t('resaleVault.certificate.cycles', 'Total cycles'),
                value: String(issued.certificate.total_cycles),
              },
              {
                label: t('resaleVault.certificate.habits', 'Charge habits score'),
                value: `${fmtNumber(issued.certificate.charge_habits_score)} / 100`,
              },
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

          {verifyMutation.isError && (
            <ErrorText>
              {t('resaleVault.certificate.verifyError', 'Self-verification failed — the signature may be stale.')}
            </ErrorText>
          )}
        </> : null}
      </SourceContent>
    </LayoutCard>
  );
}
