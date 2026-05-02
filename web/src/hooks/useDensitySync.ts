import { useEffect, useRef } from 'react'
import { useSettings } from '@/api/hooks/useSettings'

/**
 * Allowed values for the `ui_density` setting. Kept in lockstep with the
 * backend validator in `internal/api/settings_handler.go` and the Tailwind
 * tokens in `web/tailwind.config.js`.
 */
export type Density = 'compact' | 'comfortable' | 'spacious'

const DENSITY_LS_KEY = 'teslasync-density'
const ALLOWED: readonly Density[] = ['compact', 'comfortable', 'spacious']

function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (ALLOWED as readonly string[]).includes(v)
}

/**
 * Read the bootstrapped density from `<body data-density="...">`. The bootstrap
 * happens in `main.tsx` before React mounts, so this is always defined by the
 * time any component renders.
 */
export function getCurrentDensity(): Density {
  if (typeof document === 'undefined') return 'comfortable'
  const v = document.body.dataset.density
  return isDensity(v) ? v : 'comfortable'
}

/**
 * Subscribes to the user's `ui_density` setting and applies it to
 * `document.body.dataset.density` (which the CSS in `index.css` reads via
 * `body[data-density="..."]` selectors). Also persists the value to
 * localStorage so the next page load can bootstrap synchronously without a
 * flash of the wrong density.
 *
 * Only writes when the settings query has actually resolved with a valid
 * value AND the value differs from what is currently applied — this prevents
 * the bootstrap value from being clobbered by an undefined/loading state.
 */
export function useDensitySync(): void {
  const { data: settings, isSuccess } = useSettings()
  const lastApplied = useRef<Density | null>(null)

  useEffect(() => {
    if (!isSuccess) return
    const next = settings?.ui_density
    if (!isDensity(next)) return
    if (lastApplied.current === next) return
    lastApplied.current = next
    if (typeof document !== 'undefined') {
      document.body.dataset.density = next
    }
    try {
      localStorage.setItem(DENSITY_LS_KEY, next)
    } catch {
      /* quota / disabled — ignore */
    }
  }, [isSuccess, settings?.ui_density])
}
