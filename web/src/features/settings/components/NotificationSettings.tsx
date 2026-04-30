import { useTranslation } from 'react-i18next'
import { GlassPanel, IconBox, Button, Badge, Toggle } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useWebPush } from '@/hooks/useWebPush'
import { useNotificationListener, type WebPushPreferences } from '@/hooks/useNotificationListener'
import { Bell } from 'lucide-react'

export function NotificationSettings() {
  const { t } = useTranslation('settings')
  const { permission, requestPermission, isSupported: notificationsSupported } = useWebPush()
  const { prefs: pushPrefs, setPrefs: setPushPrefs } = useNotificationListener()

  return (
    <FadeIn delay={0.13}>
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <Bell className="h-5 w-5" />
          </IconBox>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('browserNotifications.title', 'Browser Notifications')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('browserNotifications.subtitle', 'Get notified when the app tab is in the background')}</p>
          </div>
        </div>

        {!notificationsSupported ? (
          <p className="text-xs text-white/40">
            {t('browserNotifications.unsupported', 'Browser notifications are not supported in this browser.')}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {permission === 'default' && (
                <Button
                  variant="primary"
                  icon={<Bell className="h-4 w-4" />}
                  onClick={requestPermission}
                >
                  {t('browserNotifications.enable', 'Enable Browser Notifications')}
                </Button>
              )}
              {permission === 'granted' && (
                <Badge variant="success">
                  {t('browserNotifications.enabled', 'Enabled')}
                </Badge>
              )}
              {permission === 'denied' && (
                <span className="text-xs text-white/40">
                  {t('browserNotifications.blocked', 'Notifications are blocked. Enable in your browser settings.')}
                </span>
              )}
            </div>

            {permission === 'granted' && (
              <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('browserNotifications.events', 'Notify me about')}
                </p>
                <Toggle
                  label={t('browserNotifications.alerts', 'Alerts')}
                  checked={pushPrefs.alerts}
                  onChange={(checked) => setPushPrefs((prev: WebPushPreferences) => ({ ...prev, alerts: checked }))}
                  size="sm"
                />
                <Toggle
                  label={t('browserNotifications.exportStatus', 'Export completions')}
                  checked={pushPrefs.exportStatus}
                  onChange={(checked) => setPushPrefs((prev: WebPushPreferences) => ({ ...prev, exportStatus: checked }))}
                  size="sm"
                />
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('browserNotifications.hint', 'Notifications only fire when the app tab is in the background.')}
                </p>
              </div>
            )}
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
