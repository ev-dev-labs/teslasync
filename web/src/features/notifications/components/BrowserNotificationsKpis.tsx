import { useTranslation } from 'react-i18next';
import { AppWindow, Bell, BellRing, Volume2 } from 'lucide-react';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { useSettings } from '@/api/hooks/useSettings';
import {
  NOTIFICATION_SOUND_CATEGORIES,
  useNotificationSoundPrefs,
} from '@/lib/notificationSound';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

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
  const settingsQuery = useSettings();
  const { data: settings } = settingsQuery;
  const settingsState = useDataState(settingsQuery);
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
  const provenance = t('browserNotifications.kpi.brief.provenance', 'Permission and in-tab events belong to this browser; tab signals use saved settings and sounds use device preferences. These are configuration counts, not delivery success rates.');
  const metrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'browser-permission', rawValue: permissionMeta.label,
      label: t('browserNotifications.kpi.permission', 'Browser permission'),
      context: <span className={neonColorMap[permissionMeta.color].text}><Bell className="h-5 w-5" aria-hidden="true" /></span> },
    { metricId: 'count', occurrenceId: 'browser-push', rawValue: pushActive, display: { countTotal: 2 },
      label: t('browserNotifications.kpi.pushEvents', 'In-tab events'),
      context: <><BellRing className="h-5 w-5" aria-hidden="true" />{activeOf(pushActive, 2)}</> },
    { metricId: 'count', occurrenceId: 'browser-tab', rawValue: tabActive, display: { countTotal: 2 },
      label: t('browserNotifications.kpi.tabSignals', 'Tab signals'),
      context: <><AppWindow className="h-5 w-5" aria-hidden="true" />{tabActive === null ? null : activeOf(tabActive, 2)}</> },
    { metricId: 'count', occurrenceId: 'browser-sounds', rawValue: soundActive, display: { countTotal: totalChannels },
      label: t('browserNotifications.kpi.soundChannels', 'Sound channels'),
      context: <><Volume2 className="h-5 w-5" aria-hidden="true" />{activeOf(soundActive, totalChannels)}</> },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

  return (
    <div className="min-w-0 space-y-3">
      <StaleRefreshWarning state={settingsState} label={t('browserNotifications.kpi.tabSignals', 'Tab signals')} hideRetry />
      <section
        aria-label={t('browserNotifications.summaryAria', 'Notification status summary')}
        className="min-w-0"
      >
        <OperationalBrief compact testId="browser-notifications-brief"
          eyebrow={t('browserNotifications.summaryAria', 'Notification status summary')}
          title={t('browserNotifications.kpi.brief.title', 'Permission and enabled notification surfaces')}
          description={provenance} metrics={operationalMetrics}
          statusLabel={permissionMeta.label}
          statusTone={permissionMeta.color === 'red' ? 'danger' : permissionMeta.color === 'amber' ? 'warning'
            : permissionMeta.color === 'green' ? 'success' : 'neutral'}
          scope={t('browserNotifications.kpi.brief.scope', 'This browser · saved tab settings')}
          freshness={<DataProvenanceBadge provenance={settingsState.provenance} status={settingsState.status} updatedAt={settingsState.updatedAt} />}
          provenance={provenance} />
      </section>
    </div>
  );
}
