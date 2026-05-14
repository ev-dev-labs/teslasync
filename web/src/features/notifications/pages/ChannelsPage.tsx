/**
 * ChannelsPage — Notification delivery channels CRUD (Discord, Slack,
 * Telegram, email, generic webhook, ntfy, Pushover). Wraps the existing
 * NotificationChannelsView; the wrapping page-container exists so this
 * surface lives at /notifications/channels and gets a real page title /
 * breadcrumb instead of being a tab inside another page.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotificationChannelsView } from '../components/NotificationChannelsView';

export default function ChannelsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.channels.title', 'Notification channels'));

  return (
    <PageContainer
      title={t('notifications.channels.title', 'Notification channels')}
      subtitle={t('notifications.channels.subtitle', 'Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.')}
      copyLink
    >
      <NotificationChannelsView />
    </PageContainer>
  );
}
