import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, IconBox, Button, Badge, Toggle, Slider } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useWebPush } from '@/hooks/useWebPush'
import { useNotificationListener, type WebPushPreferences } from '@/hooks/useNotificationListener'
import { useSettings, useSaveSettings } from '@/api/hooks/useSettings'
import {
  NOTIFICATION_SOUND_CATEGORIES,
  setNotificationSoundPrefs,
  useNotificationSoundPrefs,
  type NotificationSoundCategory,
} from '@/lib/notificationSound'
import { playNotificationSound } from '@/lib/notificationSound'
import { cn } from '@/lib/cn'
import { Bell, Volume2, Play } from 'lucide-react'

export function NotificationSettings() {
  const { t } = useTranslation('settings')
  const { permission, requestPermission, isSupported: notificationsSupported } = useWebPush()
  const { prefs: pushPrefs, setPrefs: setPushPrefs } = useNotificationListener()
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const soundPrefs = useNotificationSoundPrefs()
  const [autoplayHintDismissed, setAutoplayHintDismissed] = useState(false)

  // Default toggles to ON when the field is missing from the response
  // (e.g. very old DBs without the seeded rows). This matches the
  // backend `settingsDefaults()` and the frontend `defaults` constant.
  const tabBadgeEnabled = settings?.tab_badge_enabled !== false
  const criticalFlashEnabled = settings?.critical_flash_enabled !== false

  const updateTabSetting = (key: 'tab_badge_enabled' | 'critical_flash_enabled', value: boolean) => {
    if (!settings) return
    // Send the full settings object so the server-side full-replace
    // upsert does not zero-value any unrelated fields.
    saveSettings.mutate({ ...settings, [key]: value })
  }

  const handleTestSound = (category: NotificationSoundCategory) => {
    // Force a play even if master is off — the test button is itself a
    // user gesture and serves as the primary way to verify the cue.
    const result = playNotificationSound(category, {
      master: true,
      perCategory: { ...soundPrefs.perCategory, [category]: true },
      volume: soundPrefs.volume <= 0 ? 0.5 : soundPrefs.volume,
    })
    if (!result.played && result.reason === 'no_audio_context') {
      setAutoplayHintDismissed(false)
    }
  }

  const handleMasterToggle = (next: boolean) => {
    setNotificationSoundPrefs({ master: next })
    if (next) {
      // First master-on toggle counts as a user gesture; pre-create the
      // AudioContext so the very next SSE-driven cue is allowed to play.
      playNotificationSound('info_alert', {
        master: true,
        perCategory: { ...soundPrefs.perCategory, info_alert: true },
        volume: 0,
      })
    }
  }

  return (
    <FadeIn delay={0.13}>
      <GlassPanel className="p-6 space-y-5" data-tour="settings-notifications">
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
          <p className="text-xs text-[var(--text-muted)]">
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
                <span className="text-xs text-[var(--text-muted)]">
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

        <div className="space-y-3 pt-4 border-t border-white/[0.06]">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('settings.tab.heading', 'Browser tab signals')}
          </p>
          <Toggle
            label={t('settings.tab.badge', 'Show unread count in browser tab')}
            checked={tabBadgeEnabled}
            onChange={(checked) => updateTabSetting('tab_badge_enabled', checked)}
            size="sm"
          />
          <Toggle
            label={t('settings.tab.flash', 'Flash tab title on critical alerts')}
            checked={criticalFlashEnabled}
            onChange={(checked) => updateTabSetting('critical_flash_enabled', checked)}
            size="sm"
          />
          <p className="text-[10px] text-[var(--text-muted)]">
            {t('settings.tab.hint', 'Adds a "(N)" prefix and favicon dot when there are unread notifications. Critical alerts briefly flash "(!) ALERT" when the tab is in the background.')}
          </p>
        </div>

        <div className="space-y-4 pt-4 border-t border-white/[0.06]" data-testid="notification-sounds">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <Volume2 className="h-4 w-4" />
            </IconBox>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('notificationSounds.title', 'Notification sounds')}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {t('notificationSounds.subtitle', 'Play a short cue when an alert or completion event arrives. Plays even while the tab is visible.')}
              </p>
            </div>
          </div>

          <Toggle
            label={t('notificationSounds.master', 'Enable notification sounds')}
            checked={soundPrefs.master}
            onChange={handleMasterToggle}
            size="sm"
          />

          {soundPrefs.master && !autoplayHintDismissed && (
            <p className="text-[10px] text-amber-300/80">
              {t(
                'notificationSounds.autoplayHint',
                'Some browsers require a click before audio is allowed. Use the Test buttons below once to authorise playback.',
              )}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('notificationSounds.categoriesHeading', 'Channels')}
            </p>
            <div className="space-y-2">
              {NOTIFICATION_SOUND_CATEGORIES.map((category) => (
                <div
                  key={category}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-md border border-white/[0.04] bg-[var(--surface-2)] px-3 py-2',
                    !soundPrefs.master && 'opacity-60',
                  )}
                >
                  <Toggle
                    label={t(
                      `notificationSounds.category.${category}`,
                      categoryFallback(category),
                    )}
                    checked={soundPrefs.perCategory[category]}
                    onChange={(checked) =>
                      setNotificationSoundPrefs({
                        perCategory: { [category]: checked },
                      })
                    }
                    size="sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Play className="h-3.5 w-3.5" />}
                    onClick={() => handleTestSound(category)}
                    aria-label={t(
                      'notificationSounds.testAria',
                      'Test {{name}} sound',
                      { name: t(`notificationSounds.category.${category}`, categoryFallback(category)) },
                    )}
                  >
                    {t('notificationSounds.test', 'Test')}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-1">
            <Slider
              label={t('notificationSounds.volume', 'Volume')}
              min={0}
              max={100}
              step={5}
              value={Math.round(soundPrefs.volume * 100)}
              onChange={(next) => setNotificationSoundPrefs({ volume: next / 100 })}
              formatValue={(n) => `${n}%`}
              disabled={!soundPrefs.master}
            />
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

function categoryFallback(category: NotificationSoundCategory): string {
  switch (category) {
    case 'critical_alert':
      return 'Critical alerts'
    case 'warning_alert':
      return 'Warning alerts'
    case 'info_alert':
      return 'Informational alerts'
    case 'charge_complete':
      return 'Charge complete'
    case 'drive_complete':
      return 'Drive complete'
    case 'automation_run':
      return 'Automation runs'
    case 'achievement':
      return 'Achievements'
  }
}
