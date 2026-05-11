/**
 * BrowserNotificationsPage — Browser/OS desktop push notification setup
 * (permission, test, and per-severity routing). Wraps NotificationSettings.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotificationSettings } from '@/features/settings/components/NotificationSettings';

export default function BrowserNotificationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.browser.title', 'Browser notifications'));

  return (
    <PageContainer
      title={t('notifications.browser.title', 'Browser notifications')}
      subtitle={t('notifications.browser.subtitle', 'Native browser push notifications when alerts fire.')}
      copyLink
    >
      <NotificationSettings />
    </PageContainer>
  );
}
