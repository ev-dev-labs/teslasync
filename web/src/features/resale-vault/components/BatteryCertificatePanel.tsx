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

import { GlassPanel, PanelTitle, HelperText, Badge, CopyButton, ErrorText } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import {
  useBatteryCertificate,
  useVerifyBatteryCertificate,
} from '@/api/hooks/useBatteryCertificate';

export interface BatteryCertificatePanelProps {
  vehicleId: string | null;
}

export function BatteryCertificatePanel({ vehicleId }: BatteryCertificatePanelProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { formatEnergy } = useUnits();

  const certQuery = useBatteryCertificate(vehicleId);
  const verifyMutation = useVerifyBatteryCertificate();

  const issued = certQuery.data ?? null;
  const signature = issued?.signature ?? null;

  // Self-verify the just-issued certificate through the same public
  // endpoint a buyer would use. Runs once per signature.
  useEffect(() => {
    if (issued && !verifyMutation.isPending && verifyMutation.data === undefined && !verifyMutation.isError) {
      verifyMutation.mutate({ certificate: issued.certificate, signature: issued.signature });
    }
    // verifyMutation is stable across renders (TanStack); issued carries the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issued]);

  const verified = verifyMutation.data?.valid === true;

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('resaleVault.certificate.title', 'Battery Certificate')}
        </PanelTitle>
        {verified && (
          <Badge variant="success" size="sm" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('resaleVault.certificate.verified', 'Signature verified')}
          </Badge>
        )}
      </div>

      <HelperText>
        {t(
          'resaleVault.certificate.body',
          'A server-signed battery health attestation. Share the certificate and signature with a buyer — they can verify authenticity without an account.',
        )}
      </HelperText>

      {certQuery.isLoading ? (
        <Skeleton height={160} />
      ) : certQuery.isError || !issued ? (
        <EmptyState
          message={t('resaleVault.certificate.empty', 'No certificate available for this vehicle.')}
        />
      ) : (
        <>
          <KVList
            items={[
              {
                label: t('resaleVault.certificate.soh', 'State of health'),
                value: `${issued.certificate.current_soh.toFixed(1)}%`,
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
                value: `${issued.certificate.charge_habits_score.toFixed(0)} / 100`,
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
        </>
      )}
    </GlassPanel>
  );
}
