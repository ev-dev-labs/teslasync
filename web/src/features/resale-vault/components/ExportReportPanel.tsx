/**
 * Export panel — signs the currently-assembled `VaultReport` with the
 * active local key and offers a JSON download of the resulting
 * `SignedVaultReport`. Signing is explicit (a button press), so nothing
 * is ever signed/exported without the user seeing the privacy preview
 * first and choosing to proceed.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { Download, FileSignature, ShieldAlert } from 'lucide-react';
import { signReport } from '../lib/reportSigner';
import { CryptoUnavailableError } from '../lib/cryptoAvailability';
import { recordAuditEvent } from '../lib/auditTrail';
import { DIGEST_IS_NOT_A_SIGNATURE_NOTE } from '../lib/constants';
import type { SignedVaultReport, VaultReport } from '../lib/types';

export interface ExportReportPanelProps {
  report: VaultReport;
  onSigned?: (signed: SignedVaultReport) => void;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportReportPanel({ report, onSigned }: ExportReportPanelProps) {
  const { t } = useTranslation();
  const [signed, setSigned] = useState<SignedVaultReport | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    setIsSigning(true);
    setError(null);
    try {
      const result = await signReport(report);
      setSigned(result);
      onSigned?.(result);
      await recordAuditEvent('report_signed', `Signed report ${report.report_id} with key ${result.signature.key_id}.`);
    } catch (err) {
      if (err instanceof CryptoUnavailableError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsSigning(false);
    }
  };

  const handleDownload = async () => {
    if (!signed) return;
    downloadJson(`${report.report_id}.json`, signed);
    await recordAuditEvent('report_exported', `Exported signed report ${report.report_id} as JSON.`);
  };

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.export.title', 'Export Signed Report')}</PanelTitle>
        <FileSignature className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
      </div>

      <HelperText>
        {t(
          'resaleVault.export.subtitle',
          'Signing computes a SHA-256 digest of the report above and produces an ECDSA signature over it using your active local key.',
        )}
      </HelperText>

      {error && (
        <InlineCallout variant="danger" icon={<ShieldAlert />}>
          {error}
        </InlineCallout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void handleSign()} loading={isSigning}>
          {t('resaleVault.export.sign', 'Sign report')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void handleDownload()} disabled={!signed} icon={<Download className="h-3.5 w-3.5" />}>
          {t('resaleVault.export.download', 'Download JSON')}
        </Button>
      </div>

      {signed && (
        <div className="space-y-2 rounded-lg border border-white/[0.06] p-3 text-xs">
          <div className="flex items-center gap-2">
            <Badge variant={signed.local_key_status.persisted ? 'success' : 'warning'}>
              {signed.local_key_status.persisted
                ? t('resaleVault.export.keyPersisted', 'Signing key persisted')
                : t('resaleVault.export.keySessionOnly', 'Signing key session-only')}
            </Badge>
            {signed.local_key_status.revoked && (
              <Badge variant="danger">{t('resaleVault.export.keyRevoked', 'Signed with a revoked key')}</Badge>
            )}
          </div>
          <div className="break-all text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.digest', 'SHA-256 digest')}:</span>{' '}
            {signed.digest_sha256_hex}
          </div>
          <div className="break-all text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.keyId', 'Key ID')}:</span>{' '}
            {signed.signature.key_id}
          </div>
          <div className="text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{t('resaleVault.export.signedAt', 'Signed at')}:</span>{' '}
            {signed.signature.signed_at}
          </div>
        </div>
      )}

      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {DIGEST_IS_NOT_A_SIGNATURE_NOTE}
      </InlineCallout>
    </GlassPanel>
  );
}
