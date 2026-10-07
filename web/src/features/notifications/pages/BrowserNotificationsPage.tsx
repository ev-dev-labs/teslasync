/**
 * BrowserNotificationsPage — Browser/OS notification control center:
 * permission + delivery, browser-tab signals, and per-channel notification
 * sounds. Full-width responsive bento; each section owns its own state.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { SectionTitle, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useWebPush } from '@/hooks/useWebPush';
import { useNotificationListener } from '@/hooks/useNotificationListener';
import { BrowserNotificationsKpis } from '../components/BrowserNotificationsKpis';
import { BrowserPushChannelCard } from '../components/BrowserPushChannelCard';
import { BrowserPermissionPanel } from '../components/BrowserPermissionPanel';
import { BrowserTabSignalsPanel } from '../components/BrowserTabSignalsPanel';
import { DeviceDataUsagePanel } from '../components/DeviceDataUsagePanel';
import { DeviceNotificationPrefsPanel } from '../components/DeviceNotificationPrefsPanel';
import { NotificationSoundsPanel } from '../components/NotificationSoundsPanel';

export default function BrowserNotificationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.browser.title', 'Browser notifications'));

  // Permission + per-event push prefs are lifted here so the KPI band and the
  // permission panel share one source of truth (each hold their own local
  // state, so mounting them independently would desync after a toggle).
  const webPush = useWebPush();
  const { permission, requestPermission, isSupported } = webPush;
  const { prefs: pushPrefs, setPrefs: setPushPrefs } = useNotificationListener();

  return (
    <PageContainer
      title={t('notifications.browser.title', 'Browser notifications')}
      subtitle={t(
        'notifications.browser.subtitle',
        'Receive background push on this device and tune what happens while the tab is open.',
      )}
      copyLink
    >
      <div className="space-y-4 sm:space-y-6">
        <FadeIn>
          <section aria-label={t('webpush.title', 'Browser push')}>
            <BrowserPushChannelCard className="p-4 sm:p-5" webPush={webPush} />
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <BrowserNotificationsKpis
            permission={permission}
            notificationsSupported={isSupported}
            pushPrefs={pushPrefs}
          />
        </FadeIn>

        <FadeIn delay={0.1}>
          <SectionTitle>{t('notifications.browser.inTabTitle', 'While this tab is open')}</SectionTitle>
          <Text as="p" variant="bodySm" className="mt-1 mb-3">
            {t('notifications.browser.inTabHelp', 'These controls affect notifications and indicators in this browser tab. Browser push above delivers even when TeslaSync is closed.')}
          </Text>
          <section
            aria-label={t(
              'notifications.browser.controlsAria',
              'Notification delivery controls',
            )}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
          >
            <BrowserPermissionPanel
              className="xl:col-span-2"
              permission={permission}
              requestPermission={requestPermission}
              notificationsSupported={isSupported}
              pushPrefs={pushPrefs}
              setPushPrefs={setPushPrefs}
            />
            <BrowserTabSignalsPanel />
          </section>
        </FadeIn>

        <FadeIn delay={0.2}>
          <section
            aria-label={t(
              'notifications.device.sectionAria',
              'Per-device notification and data rules',
            )}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
          >
            <DeviceNotificationPrefsPanel className="xl:col-span-2" />
            <DeviceDataUsagePanel />
          </section>
        </FadeIn>

        <FadeIn delay={0.3}>
          <NotificationSoundsPanel />
        </FadeIn>
      </div>
    </PageContainer>
  );
}
