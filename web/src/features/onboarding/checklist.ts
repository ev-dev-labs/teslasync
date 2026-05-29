/**
 * First-run onboarding checklist.
 *
 * Tracks whether the user has actually configured the things that make
 * TeslaSync useful. Distinct from `OnboardingWizard` (one-shot intro slides)
 * and the empty-fleet placeholder — this surface remains visible until the
 * user has completed the setup steps (or explicitly dismissed it).
 *
 * Design notes:
 *   - Each task is observable from existing client state (no new backend
 *     persistence). When the underlying state flips, the task's `complete`
 *     boolean flips on the next render of `useChecklistTasks`.
 *   - The `useChecklistTasks` hook calls every dependency hook (vehicles,
 *     theme, alert rules, notification channels) in a fixed order so that
 *     the rules of hooks are respected even when tasks are gated by
 *     `show()` predicates.
 *   - "Discovered" flags live in localStorage so they survive reloads
 *     without needing a server round-trip.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Car, Palette, BellRing, Send, Command, BellPlus, LayoutGrid } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useVehicles } from '@/api/hooks/useVehicles'
import { useAlertRules, useNotificationChannels } from '@/api/hooks/useNotifications'
import { useTheme } from '@/components/ui/ThemeProvider'

/* ─── localStorage keys ─────────────────────────────────────────────────── */

export const CP_DISCOVERED_KEY = 'teslasync:cp-discovered'
export const CHECKLIST_DISMISSED_KEY = 'teslasync:checklist:dismissed'
export const CHECKLIST_COMPLETED_AT_KEY = 'teslasync:checklist:completed-at'
/**
 * Flips to '1' once the user adds their first widget via the dashboard
 * widget catalogue. Drives the `customize-dashboard`
 * checklist task. Stored client-side because there's no backend signal that
 * differentiates "user added a widget" from "user accepted the seeded
 * default layout".
 */
export const CUSTOMIZE_DASHBOARD_KEY = 'teslasync:checklist:customizeDashboard'

/** Custom event emitted when checklist-related localStorage flags change so
 * the widget can re-read state from other tabs / from the command palette. */
export const CHECKLIST_CHANGED_EVENT = 'teslasync:checklist:changed'

/** Default theme id — selecting any other theme counts as "picked a theme". */
const DEFAULT_THEME_ID = 'neon-cyan'

/* ─── Storage helpers ───────────────────────────────────────────────────── */

function safeRead(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function safeWrite(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CHECKLIST_CHANGED_EVENT))
    }
  } catch {
    // localStorage quota / private mode — silently no-op so the surfacing UI
    // does not crash. The widget will still render the in-memory tasks list.
  }
}

/* ─── Command-palette discovery instrumentation ─────────────────────────── */

/**
 * Record that the user has opened the command palette at least once. Safe to
 * call repeatedly — only writes the flag the first time. Intended to be
 * invoked from the CommandPalette open effect.
 */
export function markCommandPaletteDiscovered(): void {
  if (safeRead(CP_DISCOVERED_KEY)) return
  safeWrite(CP_DISCOVERED_KEY, '1')
}

export function isCommandPaletteDiscovered(): boolean {
  return safeRead(CP_DISCOVERED_KEY) === '1'
}

/* ─── Customize-dashboard discovery instrumentation ─────────────────────── */

/**
 * Record that the user has added at least one widget through the dashboard
 * widget catalogue. Idempotent — only writes the first time.
 */
export function markCustomizeDashboardCompleted(): void {
  if (safeRead(CUSTOMIZE_DASHBOARD_KEY)) return
  safeWrite(CUSTOMIZE_DASHBOARD_KEY, '1')
}

export function isCustomizeDashboardCompleted(): boolean {
  return safeRead(CUSTOMIZE_DASHBOARD_KEY) === '1'
}

/* ─── Dismiss / restart helpers ─────────────────────────────────────────── */

export function isChecklistDismissed(): boolean {
  return safeRead(CHECKLIST_DISMISSED_KEY) === '1'
}

export function setChecklistDismissed(dismissed: boolean): void {
  safeWrite(CHECKLIST_DISMISSED_KEY, dismissed ? '1' : null)
}

/** Used by the widget to celebrate completion for 24h before going quiet. */
export function getChecklistCompletedAt(): number | null {
  const raw = safeRead(CHECKLIST_COMPLETED_AT_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function setChecklistCompletedAt(ms: number | null): void {
  safeWrite(CHECKLIST_COMPLETED_AT_KEY, ms == null ? null : String(ms))
}

/** Clears all checklist state — used by the Settings "Restart" affordance. */
export function restartChecklist(): void {
  setChecklistDismissed(false)
  setChecklistCompletedAt(null)
}

/* ─── Web push availability ─────────────────────────────────────────────── */

export function isWebPushAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Notification !== 'undefined' &&
    'serviceWorker' in navigator
  )
}

function isWebPushGranted(): boolean {
  if (!isWebPushAvailable()) return false
  try {
    return Notification.permission === 'granted'
  } catch {
    return false
  }
}

/* ─── Task definitions ──────────────────────────────────────────────────── */

export interface ChecklistTask {
  /** Stable identifier — used for keys and analytics. */
  id: string
  /** i18n key for the task title. */
  titleKey: string
  /** English fallback for the title. */
  titleFallback: string
  /** i18n key for the one-sentence task description. */
  descriptionKey: string
  descriptionFallback: string
  /** i18n key for the CTA button label. */
  ctaKey: string
  ctaFallback: string
  /** Where the CTA navigates. The sentinel `#open-command-palette` opens
   *  the palette directly via the existing `toggle-command-palette` event
   *  instead of navigating. */
  ctaTo: string
  /** Whether the task is currently complete (computed by `useChecklistTasks`). */
  complete: boolean
  /** Optional icon for the task row. */
  icon: LucideIcon
}

/** Sentinel `ctaTo` value the widget intercepts to dispatch a palette toggle. */
export const COMMAND_PALETTE_CTA = '#open-command-palette'

/* ─── localStorage subscription helper ──────────────────────────────────── */

/**
 * Subscribes the caller to changes in checklist-related localStorage flags
 * (cross-tab via `storage`, same-tab via the custom `CHECKLIST_CHANGED_EVENT`
 * event) and to window focus events. Returns a monotonic counter the caller
 * can include in dependency arrays to force a re-read. Polling is intentional
 * — the flags update infrequently and a 5s tick keeps the widget honest if a
 * sibling component writes to localStorage without dispatching the event.
 */
export function useChecklistFlagVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)

    if (typeof window === 'undefined') return undefined

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === CP_DISCOVERED_KEY ||
        e.key === CHECKLIST_DISMISSED_KEY ||
        e.key === CHECKLIST_COMPLETED_AT_KEY ||
        e.key === CUSTOMIZE_DASHBOARD_KEY
      ) {
        bump()
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(CHECKLIST_CHANGED_EVENT, bump as EventListener)
    window.addEventListener('focus', bump)
    const interval = window.setInterval(bump, 5000)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(CHECKLIST_CHANGED_EVENT, bump as EventListener)
      window.removeEventListener('focus', bump)
      window.clearInterval(interval)
    }
  }, [])

  return version
}

export interface ChecklistState {
  tasks: ChecklistTask[]
  visibleTasks: ChecklistTask[]
  completeCount: number
  totalCount: number
  allComplete: boolean
  /** Whether the user has explicitly dismissed the checklist. */
  dismissed: boolean
  /** Epoch ms the checklist first reached 100 % complete (or `null`). */
  completedAt: number | null
  dismiss: () => void
  restart: () => void
}

/**
 * Returns the live state of the onboarding checklist. Callers should treat
 * this as a single hook with stable dependencies — every nested data hook is
 * called unconditionally on every render so the rules of hooks are honoured
 * even as tasks become complete or hidden.
 */
export function useChecklistTasks(): ChecklistState {
  const { t } = useTranslation()
  const flagVersion = useChecklistFlagVersion()

  const { data: vehicles } = useVehicles()
  const { data: alertRules } = useAlertRules()
  const { data: channels } = useNotificationChannels()
  const { themeId } = useTheme()

  // Refresh derived booleans whenever the localStorage version bumps.
  const cpDiscovered = useMemo(() => isCommandPaletteDiscovered(), [flagVersion])
  const dismissed = useMemo(() => isChecklistDismissed(), [flagVersion])
  const completedAt = useMemo(() => getChecklistCompletedAt(), [flagVersion])
  const pushGranted = useMemo(() => isWebPushGranted(), [flagVersion])
  const customizeDashboard = useMemo(() => isCustomizeDashboardCompleted(), [flagVersion])

  const tasks = useMemo<ChecklistTask[]>(() => {
    return [
      {
        id: 'connect-vehicle',
        titleKey: 'checklist.tasks.connectVehicle.title',
        titleFallback: 'Connect your Tesla',
        descriptionKey: 'checklist.tasks.connectVehicle.description',
        descriptionFallback: 'Link your Tesla account to start syncing data.',
        ctaKey: 'checklist.tasks.connectVehicle.cta',
        ctaFallback: 'Connect',
        ctaTo: '/tesla-account',
        complete: (vehicles?.length ?? 0) > 0,
        icon: Car,
      },
      {
        id: 'pick-theme',
        titleKey: 'checklist.tasks.pickTheme.title',
        titleFallback: 'Pick a theme',
        descriptionKey: 'checklist.tasks.pickTheme.description',
        descriptionFallback: 'Choose an accent color that fits your style.',
        ctaKey: 'checklist.tasks.pickTheme.cta',
        ctaFallback: 'Open',
        ctaTo: '/settings#appearance',
        complete: themeId !== DEFAULT_THEME_ID,
        icon: Palette,
      },
      {
        id: 'first-alert',
        titleKey: 'checklist.tasks.firstAlert.title',
        titleFallback: 'Create your first alert rule',
        descriptionKey: 'checklist.tasks.firstAlert.description',
        descriptionFallback: 'Get notified when something changes — battery low, charge complete, etc.',
        ctaKey: 'checklist.tasks.firstAlert.cta',
        ctaFallback: 'Create',
        ctaTo: '/notifications/alerts',
        complete: (alertRules?.length ?? 0) > 0,
        icon: BellRing,
      },
      {
        id: 'notification-channel',
        titleKey: 'checklist.tasks.notify.title',
        titleFallback: 'Add a notification channel',
        descriptionKey: 'checklist.tasks.notify.description',
        descriptionFallback: 'Without a channel (Discord, ntfy, email, …) your alerts go to /dev/null.',
        ctaKey: 'checklist.tasks.notify.cta',
        ctaFallback: 'Configure',
        ctaTo: '/notifications/channels',
        complete: (channels?.length ?? 0) > 0,
        icon: Send,
      },
      {
        id: 'try-command-palette',
        titleKey: 'checklist.tasks.commandPalette.title',
        titleFallback: 'Try the command palette',
        descriptionKey: 'checklist.tasks.commandPalette.description',
        descriptionFallback: 'Press Ctrl+K (or ⌘K) to jump anywhere instantly.',
        ctaKey: 'checklist.tasks.commandPalette.cta',
        ctaFallback: 'Open',
        ctaTo: COMMAND_PALETTE_CTA,
        complete: cpDiscovered,
        icon: Command,
      },
      {
        id: 'enable-push',
        titleKey: 'checklist.tasks.enablePush.title',
        titleFallback: 'Enable web push notifications',
        descriptionKey: 'checklist.tasks.enablePush.description',
        descriptionFallback: 'Get alerts in your browser even when TeslaSync is closed.',
        ctaKey: 'checklist.tasks.enablePush.cta',
        ctaFallback: 'Enable',
        ctaTo: '/notifications/browser',
        complete: pushGranted,
        icon: BellPlus,
      },
      {
        // Surface dashboard widget customization.
        // Completes when the user adds their first widget through the
        // catalogue dialog (which calls `markCustomizeDashboardCompleted`).
        // CTA links to the dashboard so the user can immediately spot the
        // floating + button.
        id: 'customize-dashboard',
        titleKey: 'checklist.tasks.customizeDashboard.title',
        titleFallback: 'Customize your dashboard',
        descriptionKey: 'checklist.tasks.customizeDashboard.description',
        descriptionFallback: 'Add widgets that match how you use TeslaSync.',
        ctaKey: 'checklist.tasks.customizeDashboard.cta',
        ctaFallback: 'Open',
        ctaTo: '/dashboard',
        complete: customizeDashboard,
        icon: LayoutGrid,
      },
    ]
  }, [vehicles, alertRules, channels, themeId, cpDiscovered, pushGranted, customizeDashboard])

  // Currently every task is always shown — `show()` predicates would gate
  // here. We keep the split so the widget can iterate `visibleTasks` and the
  // header counts visible tasks only.
  const visibleTasks = tasks
  const totalCount = visibleTasks.length
  const completeCount = visibleTasks.reduce((n, task) => (task.complete ? n + 1 : n), 0)
  const allComplete = totalCount > 0 && completeCount === totalCount

  // Stamp `completedAt` the first render after we hit 100 %.
  useEffect(() => {
    if (allComplete && completedAt == null) {
      setChecklistCompletedAt(Date.now())
    }
    if (!allComplete && completedAt != null) {
      // User completed something then un-completed it (e.g. revoked push) —
      // clear the celebration timestamp so completing again will re-celebrate.
      setChecklistCompletedAt(null)
    }
  }, [allComplete, completedAt])

  const dismiss = useCallback(() => setChecklistDismissed(true), [])
  const restart = useCallback(() => restartChecklist(), [])

  // Deliberately accept `t` even though we don't translate here — pages and
  // the widget run translation themselves so that updates to the i18n
  // resource are picked up without busting `useChecklistTasks` consumers.
  void t

  return {
    tasks,
    visibleTasks,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    completedAt,
    dismiss,
    restart,
  }
}

/** How long to keep the celebration state visible after 100 % complete. */
export const CELEBRATION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Should the checklist widget be hidden entirely? Used by the widget when
 * the user has either dismissed the surface or finished it long enough ago
 * that the celebration state has expired.
 */
export function shouldHideChecklist(state: Pick<ChecklistState, 'dismissed' | 'allComplete' | 'completedAt'>): boolean {
  if (state.dismissed) return true
  if (state.allComplete && state.completedAt != null) {
    return Date.now() - state.completedAt > CELEBRATION_WINDOW_MS
  }
  return false
}
