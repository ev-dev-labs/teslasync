import { useTranslation } from 'react-i18next'

export function useCommuteWeekdays() {
  const { t } = useTranslation()
  return [
    t('smartCommute.weekdays.sunday', 'Sunday'),
    t('smartCommute.weekdays.monday', 'Monday'),
    t('smartCommute.weekdays.tuesday', 'Tuesday'),
    t('smartCommute.weekdays.wednesday', 'Wednesday'),
    t('smartCommute.weekdays.thursday', 'Thursday'),
    t('smartCommute.weekdays.friday', 'Friday'),
    t('smartCommute.weekdays.saturday', 'Saturday'),
  ]
}

export function formatCommuteClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}

export function parseCommuteClock(value: string): number | null {
  const parts = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!parts) return null
  const hours = Number(parts[1])
  const minutes = Number(parts[2])
  const seconds = Number(parts[3] ?? 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds
}
