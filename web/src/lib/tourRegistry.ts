import { MAIN_TOUR } from '@/features/onboarding/tours/mainTour'
import { ALERTS_TOUR } from '@/features/onboarding/tours/alertsTour'
import { CHARGING_TOUR } from '@/features/onboarding/tours/chargingTour'
import { DRIVES_TOUR } from '@/features/onboarding/tours/drivesTour'
import { VEHICLES_TOUR } from '@/features/onboarding/tours/vehiclesTour'
import { AUTOMATIONS_TOUR } from '@/features/onboarding/tours/automationsTour'
import { SETTINGS_TOUR } from '@/features/onboarding/tours/settingsTour'
import { DEBUGGER_TOUR } from '@/features/onboarding/tours/debuggerTour'
import type { TourDefinition } from './tourState'

export * from './tourState'

export const TOURS: Record<string, TourDefinition> = {
  main: MAIN_TOUR,
  alerts: ALERTS_TOUR,
  charging: CHARGING_TOUR,
  drives: DRIVES_TOUR,
  vehicles: VEHICLES_TOUR,
  automations: AUTOMATIONS_TOUR,
  settings: SETTINGS_TOUR,
  debugger: DEBUGGER_TOUR,
}

/** Iteration order for the launcher list. */
export const TOUR_ORDER: readonly string[] = [
  'main',
  'vehicles',
  'drives',
  'charging',
  'alerts',
  'automations',
  'settings',
  'debugger',
] as const

export function getTour(id: string): TourDefinition | null {
  return Object.prototype.hasOwnProperty.call(TOURS, id) ? TOURS[id] : null
}

export function listTours(): TourDefinition[] {
  return TOUR_ORDER.map((id) => TOURS[id]).filter((d): d is TourDefinition => Boolean(d))
}
