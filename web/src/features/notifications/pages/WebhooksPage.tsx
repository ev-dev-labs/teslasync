/**
 * WebhooksPage — Custom outgoing webhook endpoints with HMAC-signed payloads,
 * delivery retry policy, and recent delivery audit. Wraps the existing
 * WebhookChannelsSection. Was a Settings sub-section; promoted to a
 * top-level Notifications page so it's discoverable in the side nav.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { WebhookChannelsSection } from '@/features/settings/components/WebhookChannelsSection';

export default function WebhooksPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.webhooks.title', 'Webhooks'));

  return (
    <PageContainer
      title={t('notifications.webhooks.title', 'Webhooks')}
      subtitle={t('notifications.webhooks.subtitle', 'Custom HTTPS endpoints that receive HMAC-signed event payloads.')}
      copyLink
    >
      <WebhookChannelsSection />
    </PageContainer>
  );
}
