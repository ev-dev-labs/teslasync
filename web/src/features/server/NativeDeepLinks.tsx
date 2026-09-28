import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Exact in-app routes a `teslasync://` link may open. Deliberately
 * small: deep links land on stable top-level pages, never on
 * parameterised detail views (those need row ids the link cannot
 * safely mint — see sw/deepLink.ts for the strict push-payload
 * policy this complements).
 */
const ALLOWED_NATIVE_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/glance',
  '/action-center',
  '/vehicles',
  '/drives',
  '/charging',
  '/battery',
  '/notifications/inbox',
])

/**
 * Map a `teslasync://` URL to an in-app route, or null when the link
 * is foreign, malformed, or targets a non-allowlisted page. Query
 * strings and fragments are dropped — v1 links carry a destination
 * only.
 */
export function nativeLinkToRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'teslasync:' && parsed.protocol !== 'web+teslasync:') return null
  const path = `/${parsed.host}${parsed.pathname}`.replace(/\/+$/, '') || '/'
  return ALLOWED_NATIVE_ROUTES.has(path) ? path : null
}

interface CapacitorAppPlugin {
  addListener(event: 'appUrlOpen', cb: (data: { url: string }) => void): Promise<{ remove: () => void }>
}

function getAppPlugin(): CapacitorAppPlugin | null {
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { App?: CapacitorAppPlugin } }
  }).Capacitor
  return cap?.Plugins?.App ?? null
}

/**
 * Subscribes to native deep-link events — Capacitor's `appUrlOpen` on
 * mobile and the Electron preload's `teslasync:deep-link` CustomEvent
 * on desktop — and routes `teslasync://` links into the SPA router.
 * No-ops in browsers and the PWA, where both are absent. Mount once
 * in <App>.
 */
export function NativeDeepLinks() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname !== '/glance') return
    const link = new URLSearchParams(location.search).get('link')
    if (link == null) return
    const route = nativeLinkToRoute(link)
    if (route != null) navigate(route, { replace: true })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    const onElectronLink = (event: Event) => {
      const route = nativeLinkToRoute((event as CustomEvent<unknown>).detail)
      if (route != null) navigate(route)
    }
    window.addEventListener('teslasync:deep-link', onElectronLink)

    const plugin = getAppPlugin()
    if (plugin == null) {
      return () => window.removeEventListener('teslasync:deep-link', onElectronLink)
    }
    let remove: (() => void) | null = null
    let cancelled = false
    void plugin
      .addListener('appUrlOpen', (data) => {
        const route = nativeLinkToRoute(data?.url)
        if (route != null) navigate(route)
      })
      .then((handle) => {
        if (cancelled) handle.remove()
        else remove = () => handle.remove()
      })
      .catch(() => {
        // Listener registration is best-effort; links still open the app.
      })
    return () => {
      cancelled = true
      remove?.()
      window.removeEventListener('teslasync:deep-link', onElectronLink)
    }
  }, [navigate])

  return null
}
