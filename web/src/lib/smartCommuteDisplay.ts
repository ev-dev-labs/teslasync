import { useTranslation } from 'react-i18next'
import { useUnits } from '@/hooks/useUnits'
import type { SmartCommuteRouteEnergy, SmartCommuteRouteEnergyBand } from '@/types/smartCommute'

export function useCommuteRouteEnergyDisplay() {
  const { t } = useTranslation()
  const { formatEnergy, formatTemperature } = useUnits()
  const values = (route: SmartCommuteRouteEnergyBand) => ({
    minutes: Math.round(route.eta_s / 60),
    count: route.drive_count,
    low: formatEnergy(route.low_wh),
    typical: formatEnergy(route.median_wh),
    high: formatEnergy(route.high_wh),
  })
  return (evidence?: SmartCommuteRouteEnergy) => {
    if (!evidence || !(Date.parse(evidence.expires_at) > Date.now())) return null
    return {
      title: t('smartCommute.traffic.energy.title', 'Compare a lower-energy route before departure'),
      fastest: t('smartCommute.traffic.energy.fastest', 'Fastest offered route: {{minutes}} min estimated by HERE; {{count}} comparable drives used {{low}} to {{high}} (median {{typical}}).', values(evidence.fastest)),
      saving: t('smartCommute.traffic.energy.saving', 'Lower-energy alternative: {{minutes}} min estimated by HERE; {{count}} comparable drives used {{low}} to {{high}} (median {{typical}}).', values(evidence.saving)),
      rationale: t('smartCommute.traffic.energy.rationale', 'Comparable completed drives used less energy on the slower route under similar conditions.'),
      conditions: t('smartCommute.traffic.energy.conditions', 'Matched routes, travel times, and outside temperature near {{temp}}.', { temp: formatTemperature(evidence.outside_c) }),
      limits: t('smartCommute.traffic.energy.limits', 'The recorded ranges suggest a lower-energy option; they do not measure or guarantee energy use on your next trip.'),
    }
  }
}

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
