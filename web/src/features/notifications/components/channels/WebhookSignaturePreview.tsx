import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton, HelperText, Text } from '@/components/ui';
import { useWebhookSignaturePreview } from '@/api/hooks/useNotificationChannels';

const SAMPLE_BODY = JSON.stringify({
  title: 'Test event',
  message: 'Hello from TeslaSync',
  source: 'teslasync',
  test: true,
});

export function WebhookSignaturePreview({ secret }: { secret: string }) {
  const { t } = useTranslation();
  const preview = useWebhookSignaturePreview();
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const mutate = useRef(preview.mutateAsync);
  mutate.current = preview.mutateAsync;

  useEffect(() => {
    setSignature('');
    setError('');
    if (!secret.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      mutate.current({ secret, body: SAMPLE_BODY }).then(
        result => { if (active) setSignature(result.signature); },
        reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
      );
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [secret]);

  if (!secret.trim()) {
    return <HelperText>{t('webhookChannels.signature.empty', 'Add a signing secret to preview the X-TeslaSync-Signature header.')}</HelperText>;
  }

  return (
    <div className="space-y-2" data-testid="webhook-signature-preview">
      <Text variant="label">{t('webhookChannels.signature.label', 'Signature preview')}</Text>
      {error ? <Text variant="bodySm" className="text-rose-300" role="alert">{t('webhookChannels.signature.error', 'Failed to compute signature: {{error}}', { error })}</Text>
        : signature ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-[var(--surface-2)] px-2 py-1 text-xs">{signature}</code>
            <CopyButton text={signature} iconOnly />
          </div>
        ) : <Text variant="bodySm">{t('webhookChannels.signature.loading', 'Computing signature…')}</Text>}
      <HelperText>{t('webhookChannels.signature.help', 'Send this header value with every webhook so receivers can verify authenticity.')}</HelperText>
    </div>
  );
}
