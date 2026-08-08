/**
 * Presentational badge for a pack's cryptographic verification state.
 *
 * Deliberately renders "signature valid" and "recognized publisher" as
 * distinct facts (never collapsed into a single "trusted" chip) — see
 * `docs/THREAT_MODEL.md` and `lib/verifyEnvelope.ts` for why that
 * distinction is load-bearing: a valid Ed25519 signature proves the
 * signer possesses the embedded private key and that the content has not
 * changed since signing. It does NOT prove the publisher is trustworthy.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import type { VerificationResult } from '../lib/verifyEnvelope';

export interface VerificationStatusBadgeProps {
  result: VerificationResult | null | undefined;
  isLoading?: boolean;
  error?: unknown;
  className?: string;
}

function isPlatformLimitation(message: string): boolean {
  return /Ed25519|Web Crypto|secure context/i.test(message);
}

export function VerificationStatusBadge({ result, isLoading, error, className }: VerificationStatusBadgeProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Badge variant="neutral" className={className}>
        {t('intelPacks.verify.checking', 'Checking signature…')}
      </Badge>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <Badge variant="danger" dot className={className}>
        {isPlatformLimitation(message)
          ? t('intelPacks.verify.platformUnsupported', 'Verification unavailable on this browser')
          : t('intelPacks.verify.error', 'Verification failed')}
      </Badge>
    );
  }

  if (!result) {
    return (
      <Badge variant="neutral" className={className}>
        {t('intelPacks.verify.unknown', 'Not verified')}
      </Badge>
    );
  }

  switch (result.status) {
    case 'signature-valid':
      return (
        <Badge variant={result.recognizedPublisherName ? 'success' : 'info'} dot className={className}>
          {result.recognizedPublisherName
            ? t('intelPacks.verify.validRecognized', 'Signature valid · recognized publisher')
            : t('intelPacks.verify.validUnrecognized', 'Signature valid · unrecognized publisher')}
        </Badge>
      );
    case 'unsigned':
      return (
        <Badge variant="warning" dot className={className}>
          {t('intelPacks.verify.unsigned', 'Unsigned — preview only')}
        </Badge>
      );
    case 'signature-invalid':
      return (
        <Badge variant="danger" dot className={className}>
          {t('intelPacks.verify.invalid', 'Signature invalid — do not trust')}
        </Badge>
      );
    case 'digest-mismatch':
      return (
        <Badge variant="danger" dot className={className}>
          {t('intelPacks.verify.digestMismatch', 'Content altered — digest mismatch')}
        </Badge>
      );
    case 'crypto-unavailable':
      return (
        <Badge variant="danger" dot className={className}>
          {t('intelPacks.verify.cryptoUnavailable', 'Web Crypto unavailable')}
        </Badge>
      );
    case 'ed25519-unsupported':
      return (
        <Badge variant="danger" dot className={className}>
          {t('intelPacks.verify.ed25519Unsupported', 'Ed25519 unsupported')}
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" className={className}>
          {t('intelPacks.verify.unknown', 'Not verified')}
        </Badge>
      );
  }
}
