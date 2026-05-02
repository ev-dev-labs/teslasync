import { useEffect, useRef } from 'react'
import { useUnreadCount } from '@/api/hooks/useNotifications'
import { useSettings } from '@/hooks/useSettings'

const FAVICON_SIZE = 32
// red-400 — matches the `severity-critical` token used elsewhere in
// the UI for at-a-glance "needs attention" colouring.
const BADGE_COLOR = '#f87171'
const BADGE_TEXT_COLOR = '#ffffff'

/**
 * Paints a coloured dot (with optional count text) on top of the
 * site favicon when there are unread notifications. Restores the
 * original favicon when the count returns to zero or the user
 * disables `tab_badge_enabled`.
 *
 * Multiple `<link rel="icon">` elements are common (we ship a default
 * SVG and a 192×192 SVG); we mutate every one in tandem so whichever
 * size the browser picks shows the badge.
 *
 * Falls back to a no-op when the favicon image fails to load (e.g.
 * inside jsdom where canvas drawing is unsupported) — the badge is a
 * progressive enhancement, never required for correctness.
 */
export function useFaviconBadge(): void {
  const { data: count = 0 } = useUnreadCount()
  const { settings } = useSettings()
  const enabled = settings.tab_badge_enabled !== false
  const originalsRef = useRef<Map<HTMLLinkElement, string>>(new Map())
  const seqRef = useRef(0)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    )
    if (links.length === 0) return

    // Snapshot original hrefs the first time we see each link so we
    // can restore them when the badge clears.
    for (const link of links) {
      if (!originalsRef.current.has(link)) {
        originalsRef.current.set(link, link.href)
      }
    }

    const restore = () => {
      for (const link of links) {
        const orig = originalsRef.current.get(link)
        if (orig !== undefined) link.href = orig
      }
    }

    if (!enabled || count <= 0) {
      restore()
      return
    }

    // Sequence number guards against a stale onload firing after the
    // count has changed again — without this, an in-flight render of
    // count=5 could overwrite a freshly-painted count=0 (restored).
    const seq = ++seqRef.current
    const firstLink = links[0]
    const orig = originalsRef.current.get(firstLink)
    if (!orig) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (seq !== seqRef.current) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = FAVICON_SIZE
        canvas.height = FAVICON_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE)

        // Coloured dot, top-right, with a faint dark outline so it
        // remains visible on light favicons.
        ctx.fillStyle = BADGE_COLOR
        ctx.beginPath()
        ctx.arc(FAVICON_SIZE - 8, 8, 7, 0, Math.PI * 2)
        ctx.fill()

        // Only render the digit when it fits cleanly in a single
        // glyph; for 10+ the dot alone signals "you have unread".
        if (count < 10) {
          ctx.fillStyle = BADGE_TEXT_COLOR
          ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(count), FAVICON_SIZE - 8, 8)
        }

        const dataUrl = canvas.toDataURL('image/png')
        for (const link of links) link.href = dataUrl
      } catch {
        // Canvas tainted (cross-origin SVG) or toDataURL unsupported
        // (jsdom). Silently skip — favicon stays at its original.
      }
    }
    img.onerror = () => {
      // Image failed to load (test env, missing file). Skip silently.
    }
    img.src = orig
  }, [count, enabled])

  // Restore originals when the host component unmounts so a navigation
  // away from the app does not leave a stale badged favicon cached.
  useEffect(() => {
    const originals = originalsRef.current
    return () => {
      for (const [link, orig] of originals.entries()) {
        link.href = orig
      }
    }
  }, [])
}
