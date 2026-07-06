import { useSyncExternalStore } from 'react'

/**
 * useSidebarStyle — user preference for the sidebar visual layout.
 *
 * Three options:
 *   - 'linear' (default) — quiet single-column tree with 2px accent bar
 *   - 'notion'           — tighter rows with caret-on-row section toggles
 *   - 'legacy'           — original multi-color icon-tile sidebar
 *
 * Stored in localStorage (not the backend `AppSettings` blob) so:
 *   - toggling is instant with no network round-trip,
 *   - the preference survives offline,
 *   - cross-tab sync is automatic via the browser `storage` event.
 *
 * If we ever want true cross-DEVICE sync (e.g. the user picks 'notion'
 * on desktop and wants it on their tablet on next login), we'd promote
 * this to a column on the server-side `settings` table. For now it
 * mirrors `useStatusBarPrefs` / `useAchievementCelebrationPrefs` — both
 * other UI-shape preferences that intentionally stay client-side because
 * they're per-device-form-factor decisions and shouldn't have to wait for
 * a network round-trip.
 *
 * Default is intentionally 'linear' (UX review 2026-05-26): the quietest
 * design that still surfaces the full nav tree on first paint.
 */

export type SidebarStyle = 'legacy' | 'linear' | 'notion'

export const SIDEBAR_STYLES: readonly SidebarStyle[] = ['linear', 'notion', 'legacy']

const STORAGE_KEY = 'teslasync:sidebar-style:v1'
const DEFAULT_STYLE: SidebarStyle = 'linear'

// Derive the runtime guard from the single SIDEBAR_STYLES source of truth so
// the accepted set can never drift from the exported list — previously adding
// a style meant editing the union, the array, AND this predicate in lock-step.
function isSidebarStyle(value: unknown): value is SidebarStyle {
  return typeof value === 'string' && (SIDEBAR_STYLES as readonly string[]).includes(value)
}

function readStyle(): SidebarStyle {
  if (typeof localStorage === 'undefined') return DEFAULT_STYLE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STYLE
    return isSidebarStyle(raw) ? raw : DEFAULT_STYLE
  } catch {
    return DEFAULT_STYLE
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal
// snapshots when nothing has changed — otherwise React 18 raises an
// infinite-render warning (see useAchievementCelebrationPrefs for the
// same pattern).
let cachedStyle: SidebarStyle = readStyle()

function getSnapshot(): SidebarStyle {
  return cachedStyle
}

function getServerSnapshot(): SidebarStyle {
  return DEFAULT_STYLE
}

function refreshSnapshot(): void {
  const next = readStyle()
  if (next !== cachedStyle) cachedStyle = next
}

const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    refreshSnapshot()
    cb()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(cb)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

/**
 * React hook — returns the currently selected sidebar style. Re-renders
 * automatically when the style changes (same tab or other tabs).
 */
export function useSidebarStyle(): SidebarStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Imperatively set the sidebar style. Triggers a re-render in every
 * mounted `useSidebarStyle()` (current tab + other tabs via the
 * `storage` event).
 */
export function setSidebarStyle(next: SidebarStyle): void {
  if (!isSidebarStyle(next) || next === cachedStyle) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // localStorage may be unavailable (private mode, quota); fall through
    // to in-memory update so the current tab still reflects the change.
  }
  cachedStyle = next
  for (const cb of listeners) cb()
}

/** Synchronous read for non-React call sites (e.g. tests). */
export function getSidebarStyle(): SidebarStyle {
  return cachedStyle
}
