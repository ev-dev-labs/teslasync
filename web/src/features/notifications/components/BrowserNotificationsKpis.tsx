import { useTranslation } from 'react-i18next';
import { AppWindow, Bell, BellRing, Volume2 } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { useSettings } from '@/api/hooks/useSettings';
import {
  NOTIFICATION_SOUND_CATEGORIES,
  useNotificationSoundPrefs,
} from '@/lib/notificationSound';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';
import type { NeonColor } from '@/lib/tokens';

interface BrowserNotificationsKpisProps {
  permission: NotificationPermission;
  notificationsSupported: boolean;
  pushPrefs: WebPushPreferences;
}

/**
 * Full-width KPI band summarising the four notification surfaces: browser
 * permission, per-event push delivery, browser-tab signals, and sound
 * channels. Each value states its status in words (not colour alone) so the
 * band stays legible for colour-blind users.
 */
export function BrowserNotificationsKpis({
  permission,
  notificationsSupported,
  pushPrefs,
}: BrowserNotificationsKpisProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const soundPrefs = useNotificationSoundPrefs();

  const permissionMeta: { label: string; color: NeonColor } = !notificationsSupported
    ? { label: t('browserNotifications.status.unsupported', 'Unsupported'), color: 'amber' }
    : permission === 'granted'
      ? { label: t('browserNotifications.status.granted', 'Enabled'), color: 'green' }
      : permission === 'denied'
        ? { label: t('browserNotifications.status.denied', 'Blocked'), color: 'red' }
        : { label: t('browserNotifications.status.default', 'Not enabled'), color: 'cyan' };

  // Defensive: this is a presentational band, so a parent that hands over an
  // undefined `pushPrefs` during a loading window degrades to "0 on" rather
  // than crashing the whole notifications page behind an error boundary.
  const pushActive = (pushPrefs?.alerts ? 1 : 0) + (pushPrefs?.exportStatus ? 1 : 0);

  const tabBadgeEnabled = settings?.tab_badge_enabled !== false;
  const criticalFlashEnabled = settings?.critical_flash_enabled !== false;
  const tabActive = settings
    ? (tabBadgeEnabled ? 1 : 0) + (criticalFlashEnabled ? 1 : 0)
    : null;

  const totalChannels = NOTIFICATION_SOUND_CATEGORIES.length;
  const soundActive = soundPrefs?.master
    ? NOTIFICATION_SOUND_CATEGORIES.filter((c) => soundPrefs.perCategory?.[c]).length
    : 0;

  const activeOf = (active: number, total: number) =>
    t('browserNotifications.kpi.activeOfTotal', '{{active}} of {{total}} on', { active, total });

  return (
    <section
      aria-label={t('browserNotifications.summaryAria', 'Notification status summary')}
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      <MetricCard
        label={t('browserNotifications.kpi.permission', 'Browser permission')}
        value={permissionMeta.label}
        icon={<Bell className="h-5 w-5" aria-hidden="true" />}
        color={permissionMeta.color}
      />
      <MetricCard
        label={t('browserNotifications.kpi.pushEvents', 'Push events')}
        value={`${pushActive}/2`}
        subtitle={activeOf(pushActive, 2)}
        icon={<BellRing className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('browserNotifications.kpi.tabSignals', 'Tab signals')}
        value={tabActive === null ? '—' : `${tabActive}/2`}
        subtitle={tabActive === null ? undefined : activeOf(tabActive, 2)}
        icon={<AppWindow className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('browserNotifications.kpi.soundChannels', 'Sound channels')}
        value={`${soundActive}/${totalChannels}`}
        subtitle={activeOf(soundActive, totalChannels)}
        icon={<Volume2 className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
    </section>
  );
}
