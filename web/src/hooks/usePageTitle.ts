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
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = getBaseTitle()
    setBaseTitle(`${title} — TeslaSync`)
    return () => { setBaseTitle(prev) }
  }, [title])
}
