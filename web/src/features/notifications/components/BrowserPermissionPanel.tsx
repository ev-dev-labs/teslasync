import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff } from 'lucide-react';
import {
  Badge,
  Button,
  GlassPanel,
  HelperText,
  IconBox,
  Label,
  PanelTitle,
  Text,
  Toggle,
} from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';

interface BrowserPermissionPanelProps {
  className?: string;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  notificationsSupported: boolean;
  pushPrefs: WebPushPreferences;
  setPushPrefs: (
    next: WebPushPreferences | ((prev: WebPushPreferences) => WebPushPreferences),
  ) => void;
}

/**
 * Primary panel: browser Notification permission state (enable / enabled /
 * blocked / unsupported) plus the per-event delivery toggles that only apply
 * once permission is granted.
 */
export function BrowserPermissionPanel({
  className,
  permission,
  requestPermission,
  notificationsSupported,
  pushPrefs,
  setPushPrefs,
}: BrowserPermissionPanelProps) {
  const { t } = useTranslation();

  // `requestPermission()` returns a Promise that can reject in some browsers
  // (e.g. when the permission prompt is dismissed by a policy). Catch it so a
  // click never surfaces an unhandled rejection — the resolved permission
  // flows back in through the `permission` prop, so there is nothing to do on
  // failure beyond letting the user retry.
  const handleEnable = useCallback(() => {
    requestPermission().catch(() => {
      /* prompt failed — state stays 'default'; the button remains for retry */
    });
  }, [requestPermission]);

  return (
    <GlassPanel className={className} data-tour="settings-notifications">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <div className="min-w-0">
            <PanelTitle>{t('browserNotifications.title', 'Browser Notifications')}</PanelTitle>
            <Text variant="caption" as="p">
              {t(
                'browserNotifications.subtitle',
                'Get notified when the app tab is in the background',
              )}
            </Text>
          </div>
        </div>

        {!notificationsSupported ? (
          <InlineCallout variant="warning" icon={<BellOff aria-hidden="true" />}>
            {t(
              'browserNotifications.unsupported',
              'Browser notifications are not supported in this browser.',
            )}
          </InlineCallout>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {permission === 'default' && (
                <Button
                  variant="primary"
                  icon={<Bell className="h-4 w-4" aria-hidden="true" />}
                  onClick={handleEnable}
                >
                  {t('browserNotifications.enable', 'Enable Browser Notifications')}
                </Button>
              )}
              {permission === 'granted' && (
                <Badge variant="success">{t('browserNotifications.enabled', 'Enabled')}</Badge>
              )}
              {permission === 'denied' && (
                <InlineCallout variant="warning" icon={<BellOff aria-hidden="true" />}>
                  {t(
                    'browserNotifications.blocked',
                    'Notifications are blocked. Enable in your browser settings.',
                  )}
                </InlineCallout>
              )}
            </div>

            {permission === 'granted' && (
              <div className="space-y-3 border-t border-white/[0.06] pt-4">
                <Label>{t('browserNotifications.events', 'Notify me about')}</Label>
                <Toggle
                  label={t('browserNotifications.alerts', 'Alerts')}
                  checked={pushPrefs.alerts ?? false}
                  onChange={(checked) =>
                    setPushPrefs((prev) => ({ ...prev, alerts: checked }))
                  }
                  size="sm"
                />
                <Toggle
                  label={t('browserNotifications.exportStatus', 'Export completions')}
                  checked={pushPrefs.exportStatus ?? false}
                  onChange={(checked) =>
                    setPushPrefs((prev) => ({ ...prev, exportStatus: checked }))
                  }
                  size="sm"
                />
                <HelperText>
                  {t(
                    'browserNotifications.hint',
                    'Notifications only fire when the app tab is in the background.',
                  )}
                </HelperText>
              </div>
            )}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
