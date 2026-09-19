import type { TFunction } from 'i18next'

export const DEFAULT_ALERT_COOLDOWN_S = 15 * 60

export function getAlertBehaviorOptions(t: TFunction) {
  return [
    { value: 'repeat', label: t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved') },
    { value: 'once', label: t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event') },
  ]
}
