import type { TourStep } from '@/hooks/useTour'

/**
 * Tour registry — Phase-40 / Prompt 65.
 *
 * Per-feature onboarding tours. Each definition declares its identity, the
 * route it is most relevant on (used by the launcher to highlight
 * "recommended for this page"), a version (bump to silently invalidate any
 * previously stored completion flag — same trick as Prompt 55 form drafts),
 * and the ordered list of {@link TourStep} entries the user is walked
 * through.
 *
 * Storage model:
 *   - Per-tour completion flag: `teslasync:tour:v{version}:{id}` →
 *     `'completed' | 'skipped'`. When the version stored on disk does not
 *     match the registry version, the tour is treated as "not yet seen"
 *     so users get re-prompted after a meaningful update.
 *   - Launcher-seen flag: `teslasync:tour:list-seen` → `'true'` once the
 *     launcher has been opened at least once. Used to surface the
 *     "More tours available" hint to brand-new users.
 */

export type TourCompletionStatus = 'completed' | 'skipped'

export interface TourDefinition {
  /** Stable identifier — used for storage key, registry lookup, telemetry */
  id: string
  /**
   * Routes where the launcher should highlight this tour as
   * "recommended for this page". Provide a string for an exact prefix or a
   * RegExp for more nuanced matching (e.g. drive detail pages).
   */
  routeMatch: string | RegExp
  /** i18n key for the tour's display name in the launcher */
  titleKey: string
  /** English fallback for {@link titleKey} */
  titleFallback: string
  /** i18n key for the one-line description */
  descriptionKey: string
  /** English fallback for {@link descriptionKey} */
  descriptionFallback: string
  /**
   * Bump this when the tour content materially changes. Any user whose
   * stored completion was at an older version gets the tour re-offered the
   * next time the auto-start predicate matches.
   */
  version: number
  steps: TourStep[]
  /**
   * Optional predicate evaluated on route changes. When it returns true and
   * the tour has not been completed at the current version, the tour starts
   * automatically. Per the prompt, only the `main` tour opts in by default;
   * every other tour stays explicit (launcher-only) so we don't interrupt
   * users who already know the app.
   */
  autoStart?: (ctx: TourAutoStartContext) => boolean
}

/** Context passed to {@link TourDefinition.autoStart} predicates. */
export interface TourAutoStartContext {
  pathname: string
  vehicleCount: number
}

const STORAGE_PREFIX = 'teslasync:tour'
const LIST_SEEN_KEY = `${STORAGE_PREFIX}:list-seen`

function storageKey(id: string, version: number): string {
  return `${STORAGE_PREFIX}:v${version}:${id}`
}

/** Returns the stored completion status for a tour at a given version, or null. */
export function getTourStatus(id: string, version: number): TourCompletionStatus | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(id, version))
    if (raw === 'completed' || raw === 'skipped') return raw
    return null
  } catch {
    return null
  }
}

/** True when the user has finished or skipped the tour at the current version. */
export function isTourCompleted(id: string, version: number): boolean {
  return getTourStatus(id, version) !== null
}

/** Marks a tour as completed (user finished all steps). */
export function markTourCompleted(id: string, version: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(id, version), 'completed')
  } catch {
    /* localStorage quota / disabled — non-fatal */
  }
}

/** Marks a tour as skipped (user closed mid-way). */
export function markTourSkipped(id: string, version: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(id, version), 'skipped')
  } catch {
    /* non-fatal */
  }
}

/** Clears the completion flag for a single tour (any version). */
export function resetTour(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const prefix = `${STORAGE_PREFIX}:`
    const suffix = `:${id}`
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(prefix) && key.endsWith(suffix)) {
        toRemove.push(key)
      }
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* non-fatal */
  }
}

/** Clears every per-tour completion flag and the list-seen marker. */
export function resetAllTours(): void {
  if (typeof window === 'undefined') return
  try {
    const prefix = `${STORAGE_PREFIX}:`
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(prefix)) toRemove.push(key)
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k))
    // Legacy single-flag from the pre-Prompt-65 implementation. Removing it
    // ensures "Reset all tours" actually re-enables the dashboard auto-start
    // for users who completed the tour before the migration.
    window.localStorage.removeItem('teslasync-tour-completed')
  } catch {
    /* non-fatal */
  }
}

/** Has the launcher been opened at least once? */
export function hasSeenTourList(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(LIST_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

/** Records that the launcher has been opened. */
export function markTourListSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LIST_SEEN_KEY, 'true')
  } catch {
    /* non-fatal */
  }
}

/** True when the path matches the tour's route hint. */
export function isRecommendedForRoute(def: TourDefinition, pathname: string): boolean {
  if (typeof def.routeMatch === 'string') {
    if (def.routeMatch === '/') return pathname === '/'
    return pathname === def.routeMatch || pathname.startsWith(`${def.routeMatch}/`)
  }
  return def.routeMatch.test(pathname)
}

/**
 * Custom event name used to start a tour from anywhere in the app
 * (TourLauncher, command palette, status-bar menus, etc). The Layout listens
 * for this event and resolves the id against {@link TOURS}.
 */
export const TOUR_START_EVENT = 'teslasync:tour:start'

/**
 * Custom event name used to open the launcher (the modal that lists every
 * available tour). Mirrors the existing `toggle-keyboard-shortcuts` pattern
 * so the launcher does not need to be threaded through React context.
 */
export const TOUR_OPEN_LAUNCHER_EVENT = 'teslasync:tour:openLauncher'

export interface TourStartEventDetail {
  id: string
}

/** Convenience helper to dispatch the start event. */
export function dispatchTourStart(id: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<TourStartEventDetail>(TOUR_START_EVENT, { detail: { id } }),
  )
}

/** Convenience helper to dispatch the launcher-open event. */
export function dispatchTourLauncherOpen(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOUR_OPEN_LAUNCHER_EVENT))
}

// ─── Registry ───────────────────────────────────────────────────────────────

import { MAIN_TOUR } from '@/features/onboarding/tours/mainTour'
import { ALERTS_TOUR } from '@/features/onboarding/tours/alertsTour'
import { CHARGING_TOUR } from '@/features/onboarding/tours/chargingTour'
import { DRIVES_TOUR } from '@/features/onboarding/tours/drivesTour'
import { VEHICLES_TOUR } from '@/features/onboarding/tours/vehiclesTour'
import { AUTOMATIONS_TOUR } from '@/features/onboarding/tours/automationsTour'
import { SETTINGS_TOUR } from '@/features/onboarding/tours/settingsTour'
import { DEBUGGER_TOUR } from '@/features/onboarding/tours/debuggerTour'

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

/** Lookup helper that returns the definition or null. */
export function getTour(id: string): TourDefinition | null {
  return TOURS[id] ?? null
}

/** Returns every tour in display order. */
export function listTours(): TourDefinition[] {
  return TOUR_ORDER.map((id) => TOURS[id]).filter((d): d is TourDefinition => Boolean(d))
}
