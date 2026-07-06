import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings as useSettingsQuery } from '@/api/hooks/useSettings'
import { subscribe } from '@/lib/broadcast'
import { TOPICS } from '@/lib/broadcastTopics'
import { resolveLocale } from '@/lib/locale'
import {
  setGlobalLocale,
  setGlobalPrecision,
  getGlobalLocale,
  getGlobalPrecision,
} from '@/lib/numberFormat'

/**
 * Default decimal precision applied when the persisted `decimal_precision`
 * setting is absent (null/undefined). Mirrors the formatter default in
 * `@/lib/numberFormat`.
 */
const DEFAULT_DECIMAL_PRECISION = 2

/**
 * Keeps module-level formatter globals
 * (`numberFormat._globalLocale`, `_globalPrecision`) in sync with the
 * persisted user settings, regardless of which page is currently
 * mounted.
 *
 * ## Why this exists
 *
 * `useSettings()` (the derived hook in `@/hooks/useSettings`) sets the
 * formatter globals on every render. That works whenever a page actually
 * consumes that hook — which most pages do — but it leaves a hole:
 *
 *   1. A page that imports a formatter directly (`fmtNumber`,
 *      `formatDuration`, …) without going through `useSettings()` will
 *      render with whatever locale/precision was last set.
 *   2. Cross-tab `invalidateAndBroadcast(['settings'])` only causes a
 *      refetch in tabs that already have an active subscriber for the
 *      `['settings']` query. A tab whose only mounted page never calls
 *      `useSettings()` would sit on stale globals until the user
 *      navigates.
 *
 * Mounting this bridge near the React root creates a permanent
 * subscriber for the `['settings']` query (so cross-tab invalidations
 * always refetch) AND applies the resolved locale + decimal precision
 * to the module-level globals via `useEffect` — without forcing every
 * page to remember to call `useSettings()` itself.
 *
 * The bridge also subscribes to the {@link TOPICS.SETTINGS_CHANGED}
 * broadcast as a defense-in-depth path: if a future caller mutates
 * settings without going through the React Query layer, it can fire
 * the topic directly and the bridge will refetch.
 *
 * ## Render output
 *
 * `null` — this is a side-effect-only mount. Place it under
 * `<QueryClientProvider>` (it uses TanStack Query) but outside any
 * route-specific tree so it stays mounted for the lifetime of the app.
 */
export function FormatterPrefsBridge(): null {
  const qc = useQueryClient()
  const { data: settings } = useSettingsQuery()

  // Apply globals from the resolved query data. Runs in `useEffect`
  // (not during render) so the writes land in React's commit phase and
  // are never a side effect of an interrupted/replayed render.
  //
  // Settings is the single source of truth for these module-level
  // globals, so re-assert on every resolve: if a value the bridge did
  // NOT write drifted in — e.g. a page's own `useSettings()` applied a
  // transient/stale locale while this bridge stayed mounted — it is
  // corrected on the next settings resolution. The `!==` guards keep
  // each write idempotent (no redundant `setGlobal*` when the global
  // already matches), which also makes StrictMode's double-invoked
  // effect a no-op on its second pass.
  useEffect(() => {
    if (!settings) return
    const locale = resolveLocale(settings.locale)
    if (locale !== getGlobalLocale()) setGlobalLocale(locale)

    const decimals = settings.decimal_precision ?? DEFAULT_DECIMAL_PRECISION
    if (decimals !== getGlobalPrecision()) setGlobalPrecision(decimals)
  }, [settings])

  // Defense in depth: if a peer broadcasts a `settings.changed` topic
  // without going through `invalidateAndBroadcast` (e.g. an admin
  // reset, a future devtool, an external action), force a refetch so
  // the effect above re-runs against fresh data.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) return
      void qc.invalidateQueries({ queryKey: ['settings'] })
    })
  }, [qc])

  return null
}
