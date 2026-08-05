/**
 * The single non-negotiable distinction this feature must never blur:
 * "signature valid" (key possession + content integrity) vs. "trustworthy
 * publisher" (a human/policy judgement this app cannot make for you).
 * Rendered wherever a verification result is shown so the two concepts
 * never collapse into one "trusted" chip.
 */
import { useTranslation } from 'react-i18next';
import { ShieldQuestion } from 'lucide-react';
import { InlineCallout } from '@/components/feedback';

export function TrustDistinctionNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <InlineCallout variant="info" icon={<ShieldQuestion />} className={className}>
      {t(
        'intelPacks.trust.distinctionNote',
        'A valid signature proves the publisher possesses the signing key and that the content has not changed since signing. It does not prove the publisher\u2019s intentions are trustworthy — that judgement is always yours.',
      )}
    </InlineCallout>
  );
}
