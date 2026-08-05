/**
 * Renders a signing-key SHA-256 fingerprint in the human-friendly grouped
 * hex format (`formatFingerprint`), with a copy affordance and, when the
 * fingerprint matches a locally-bundled recognized publisher, a badge
 * naming it. Never fetches anything — the recognized-publisher check is a
 * static local lookup (`lib/trust.ts`).
 */
import { useTranslation } from 'react-i18next';
import { Badge, CopyButton } from '@/components/ui';
import { formatFingerprint } from '../lib/trust';

export interface PublisherFingerprintDisplayProps {
  fingerprintHex: string | null;
  recognizedName?: string | null;
  claimedMismatch?: boolean;
  className?: string;
}

export function PublisherFingerprintDisplay({
  fingerprintHex,
  recognizedName,
  claimedMismatch,
  className,
}: PublisherFingerprintDisplayProps) {
  const { t } = useTranslation();

  if (!fingerprintHex) {
    return (
      <span className={className}>
        <span className="text-xs text-[var(--text-muted)]">{t('intelPacks.fingerprint.none', 'No signing key (unsigned)')}</span>
      </span>
    );
  }

  const formatted = formatFingerprint(fingerprintHex);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs text-[var(--text-secondary)] break-all">{formatted}</code>
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
        <p className="mt-1 text-xs text-rose-300">
          {t(
            'intelPacks.fingerprint.claimMismatch',
            'The manifest\u2019s self-claimed publisher fingerprint does not match the fingerprint recomputed from the actual signing key. Treat this as suspicious.',
          )}
        </p>
      )}
    </div>
  );
}
