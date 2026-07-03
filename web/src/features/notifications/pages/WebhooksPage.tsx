/**
 * WebhooksPage — modern-ui full-width redesign of the custom outgoing webhook
 * endpoints manager.
 *
 * Orchestrates three sections in a responsive bento that fills the viewport on
 * every breakpoint (1 column on phones → a 3-column bento on `xl`+):
 *   1. WebhookSummary        — full-width KPI band derived from useWebhookChannels().
 *   2. WebhookChannelsSection — the deterministic CRUD hero (spans 2/3 on `xl`);
 *                               HMAC-signed payloads, per-row Test/Edit/Delete,
 *                               and the live X-TeslaSync-Signature preview.
 *   3. WebhookGuide          — static how-it-works rail (signing + delivery
 *                               reference + payload fields).
 *
 * The single `useWebhookChannels()` query is shared with the CRUD section via
 * TanStack's queryKey dedupe, so the KPI band and the freshness chip cost no
 * extra request. WebhookChannelsSection keeps the sole write path.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useWebhookChannels } from '@/api/hooks/useNotificationChannels';
import { WebhookChannelsSection } from '@/features/settings/components/WebhookChannelsSection';
import { WebhookSummary } from '../components/WebhookSummary';
import { WebhookGuide } from '../components/WebhookGuide';

export default function WebhooksPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.webhooks.title', 'Webhooks'));

  // Shared with WebhookChannelsSection's own fetch via TanStack's queryKey
  // dedupe, so the KPI band and the freshness chip cost no extra request.
  const webhooksQuery = useWebhookChannels();

  return (
    <PageContainer
      title={t('notifications.webhooks.title', 'Webhooks')}
      subtitle={t('notifications.webhooks.subtitle', 'Custom HTTPS endpoints that receive HMAC-signed event payloads.')}
      query={webhooksQuery}
      copyLink
    >
      <FadeIn>
        <WebhookSummary query={webhooksQuery} />
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <div className="min-w-0 xl:col-span-2">
          <WebhookChannelsSection />
        </div>
        <div className="min-w-0 xl:col-span-1">
          <FadeIn delay={0.2}>
            <WebhookGuide />
          </FadeIn>
        </div>
      </div>
    </PageContainer>
  );
}
