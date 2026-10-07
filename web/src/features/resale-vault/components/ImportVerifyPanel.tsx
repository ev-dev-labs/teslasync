/**
 * Import & verify panel — lets a user load an externally-produced
 * `SignedVaultReport` JSON file (e.g. one they received from a buyer,
 * dealer, or their own export from another browser) and run the
 * independent verification workflow against it.
 *
 * Verification is entirely local and self-contained: the signature's
 * public JWK travels with the report, so nothing needs to be "looked up"
 * anywhere to check the digest/signature math. What IS looked up locally
 * is whether the signing key happens to be one this browser recognizes
 * (and whether it's since been revoked) — a trust signal, not a
 * cryptographic requirement.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge, Input } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { FileCheck2, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { verifyReport } from '../lib/reportVerifier';
import { CryptoUnavailableError } from '../lib/cryptoAvailability';
import { recordAuditEvent } from '../lib/auditTrail';
import { DIGEST_IS_NOT_A_SIGNATURE_NOTE, LOCAL_ATTESTATION_NOTE } from '../lib/constants';
import type { SignedVaultReport, VerificationResult } from '../lib/types';

function isSignedVaultReportShape(value: unknown): value is SignedVaultReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.report === 'object' &&
    record.report !== null &&
    typeof record.digest_sha256_hex === 'string' &&
    typeof record.signature === 'object' &&
    record.signature !== null
  );
}

export function ImportVerifyPanel() {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState<string | null>(null);
  const [imported, setImported] = useState<SignedVaultReport | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    setImported(null);
    setFileName(file.name);
    setIsVerifying(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isSignedVaultReportShape(parsed)) {
        setError(
          t(
            'resaleVault.import.badShape',
            'This file does not look like a signed vault report (missing report/digest/signature fields).',
          ),
        );
        return;
      }
      setImported(parsed);
      const verification = await verifyReport(parsed);
      setResult(verification);
      await recordAuditEvent('report_imported', `Imported report ${parsed.report?.report_id ?? 'unknown'} from file "${file.name}".`);
      await recordAuditEvent(
        'report_verified',
        `Verified imported report ${parsed.report?.report_id ?? 'unknown'}: ${verification.valid ? 'valid' : 'INVALID'}.`,
      );
    } catch (err) {
      if (err instanceof CryptoUnavailableError) {
        setError(err.message);
      } else if (err instanceof SyntaxError) {
        setError(t('resaleVault.import.badJson', 'This file is not valid JSON.'));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  };

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.import.title', 'Import & Verify a Report')}</PanelTitle>
        <FileCheck2 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
      </div>

      <HelperText>
        {t(
          'resaleVault.import.subtitle',
          'Load a signed report JSON file (from this browser or another one) to independently check its digest and signature.',
        )}
      </HelperText>

      <div className="space-y-2">
        <Input
          type="file"
          accept="application/json,.json"
          onChange={onInputChange}
          label={t('resaleVault.import.chooseFile', 'Choose report file')}
        />
        {fileName && <span className="ml-2 text-xs text-[var(--text-muted)]">{fileName}</span>}
      </div>

      {isVerifying && <HelperText>{t('resaleVault.import.verifying', 'Verifying…')}</HelperText>}

      {error && (
        <InlineCallout variant="danger" icon={<ShieldAlert />}>
          {error}
        </InlineCallout>
      )}

      {result && imported && (
        <div className="space-y-3 rounded-lg border border-white/[0.06] p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.valid ? 'success' : 'danger'} size="md">
              {result.valid
                ? t('resaleVault.import.valid', 'All checks passed')
                : t('resaleVault.import.invalid', 'Some checks failed')}
            </Badge>
            <Badge variant={result.digestMatches ? 'success' : 'danger'}>
              {result.digestMatches
                ? t('resaleVault.import.digestMatches', 'Digest matches')
                : t('resaleVault.import.digestMismatch', 'Digest mismatch')}
            </Badge>
            <Badge variant={result.signatureValid ? 'success' : 'danger'}>
              {result.signatureValid
                ? t('resaleVault.import.sigValid', 'Signature valid')
                : t('resaleVault.import.sigInvalid', 'Signature invalid')}
            </Badge>
            {result.isKnownLocalKey && (
              <Badge variant={result.localKeyRevoked ? 'danger' : 'info'}>
                {result.localKeyRevoked
                  ? t('resaleVault.import.knownRevoked', 'Signed with a locally-known, revoked key')
                  : t('resaleVault.import.knownKey', 'Signed with a key known to this browser')}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            {result.valid ? (
              <ShieldCheck className="h-4 w-4 text-[var(--color-success,#22c55e)]" aria-hidden />
            ) : (
              <ShieldX className="h-4 w-4 text-[var(--color-danger,#ef4444)]" aria-hidden />
            )}
            <span className="font-mono break-all">{t('resaleVault.import.keyId', 'Key ID')}: {result.keyId}</span>
          </div>

          {result.errors.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-[var(--text-secondary)]">
              {result.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}

          <div className="text-[var(--text-muted)]">
            {t('resaleVault.import.reportId', 'Report ID')}: {imported.report.report_id}
          </div>

          <InlineCallout variant="info" icon={<ShieldAlert />}>
            {result.attestationNote}
          </InlineCallout>
        </div>
      )}

      {!result && !error && !isVerifying && (
        <HelperText>{t('resaleVault.import.empty', 'No report imported yet in this session.')}</HelperText>
      )}

      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {DIGEST_IS_NOT_A_SIGNATURE_NOTE}
      </InlineCallout>
      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {LOCAL_ATTESTATION_NOTE}
      </InlineCallout>
    </GlassPanel>
  );
}
