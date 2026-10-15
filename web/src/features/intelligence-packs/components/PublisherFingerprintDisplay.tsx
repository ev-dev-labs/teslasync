/**
 * Renders a signing-key SHA-256 fingerprint in the human-friendly grouped
 * hex format (`formatFingerprint`), with a copy affordance and, when the
 * fingerprint matches a locally-bundled recognized publisher, a badge
 * naming it. Never fetches anything — the recognized-publisher check is a
 * static local lookup (`lib/trust.ts`).
 */
import { useTranslation } from 'react-i18next';
import { Badge, Caption, Code, CopyButton, ErrorText } from '@/components/ui';
import { formatFingerprint } from '../lib/trust';
import type { VerificationResult } from '../lib/verifyEnvelope';
import { VerificationStatusBadge } from './VerificationStatusBadge';

export interface PublisherFingerprintDisplayProps {
  fingerprintHex: string | null;
  hasSignature?: boolean;
  verificationResult?: VerificationResult | null;
  isLoading?: boolean;
  error?: unknown;
  recognizedName?: string | null;
  claimedMismatch?: boolean;
  className?: string;
}

export function PublisherFingerprintDisplay({
  fingerprintHex,
  hasSignature,
  verificationResult,
  isLoading,
  error,
  recognizedName,
  claimedMismatch,
  className,
}: PublisherFingerprintDisplayProps) {
  const { t } = useTranslation();

  if (hasSignature === false || (hasSignature == null && verificationResult?.status === 'unsigned')) {
    return (
      <span className={className}>
        <Caption>{t('intelPacks.fingerprint.none', 'No signing key (unsigned)')}</Caption>
      </span>
    );
  }

  if (isLoading || error || !fingerprintHex || !/^[a-f0-9]{64}$/i.test(fingerprintHex)) {
    return (
      <VerificationStatusBadge
        result={verificationResult?.status === 'unsigned' ? null : verificationResult}
        isLoading={isLoading}
        error={error}
        className={className}
      />
    );
  }

  const formatted = formatFingerprint(fingerprintHex);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Code className="break-all">{formatted}</Code>
        <CopyButton text={fingerprintHex} iconOnly label={t('intelPacks.fingerprint.copy', 'Copy fingerprint')} />
        {recognizedName ? (
          <Badge variant="success" size="sm">
            {t('intelPacks.fingerprint.recognized', 'Recognized: {{name}}', { name: recognizedName })}
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            {t('intelPacks.fingerprint.unrecognized', 'Not in local recognized-publisher list')}
          </Badge>
        )}
      </div>
      {claimedMismatch && (
        <ErrorText as="p" className="mt-1">
          {t(
            'intelPacks.fingerprint.claimMismatch',
            'The manifest\u2019s self-claimed publisher fingerprint does not match the fingerprint recomputed from the actual signing key. Treat this as suspicious.',
          )}
        </ErrorText>
      )}
    </div>
  );
}
