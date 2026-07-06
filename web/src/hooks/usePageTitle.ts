import { useEffect } from 'react'
import { getBaseTitle, setBaseTitle } from '@/lib/titleStore'

/**
 * Sets the document title for the current page in the format
 * `"{title} — TeslaSync"` while preserving any tab-badge prefix
 * (unread-count badge, critical-alert flash) painted by other hooks.
 *
 * Writes go through the `titleStore` singleton rather than
 * `document.title` directly so the badge prefix is re-applied
 * automatically whenever the canonical title changes (e.g. on
 * navigation between pages). See `web/src/lib/titleStore.ts`.
 *
 * An empty, whitespace-only, or nullish `title` collapses to the bare
 * app name (`"TeslaSync"`) instead of emitting a dangling
 * `" — TeslaSync"` separator. This matters for dynamic titles — a trip
 * label, incident subject, or vehicle name — that can briefly resolve to
 * `''` while their data loads. `"TeslaSync"` is kept in sync with the
 * `titleStore` default so the restore-on-unmount path round-trips cleanly.
 */
const APP_NAME = 'TeslaSync'

export function usePageTitle(title: string) {
  useEffect(() => {
    const trimmed = title?.trim() ?? ''
    const prev = getBaseTitle()
    setBaseTitle(trimmed ? `${trimmed} — ${APP_NAME}` : APP_NAME)
    return () => { setBaseTitle(prev) }
  }, [title])
}
