import { useEffect } from 'react'
import { useTheme } from '@/components/ui/ThemeProvider'
import {
  buildAppIconSvg,
  renderSvgToPngDataUrl,
  svgToDataUrl,
} from '@/lib/appIcon'

/**
 * Marker attribute we tag every dynamically-mutated `<link>` / `<meta>` with.
 * Lets `useFaviconBadge` find the "live base" href without needing a shared
 * React context — and lets us safely no-op when the same theme is re-applied.
 */
const DYNAMIC_MARK = 'data-dynamic-app-icon'

/**
 * Default fallback colour used when the manifest theme-color meta is missing.
 * Matches the build-time `background_color` in `vite.config.ts`.
 */
const FALLBACK_BG = '#0b0d12'

/**
 * Re-tints the browser tab favicon, the iOS apple-touch-icon, the
 * `<meta name="theme-color">` tag in real time. The bolt follows the chosen
 * theme primary while browser chrome follows the active surface mode.
 *
 * Layer 1 — favicon (instant, every browser):
 *   Mutates every `<link rel="icon">` to a base64-encoded SVG data URL with
 *   the active bolt mark. Inlines a `data-dynamic-app-icon`
 *   marker so `useFaviconBadge` knows it can re-snapshot the live href
 *   instead of restoring to the build-time default.
 *
 * Layer 2 — apple-touch-icon (best-effort, iOS install-time):
 *   Renders the apple variant SVG to a 180×180 PNG via canvas and pushes it
 *   into `<link rel="apple-touch-icon">`. Only takes effect when the user
 *   does "Add to Home Screen" — existing iOS installs are baked.
 *
 * Android uses the build-time HTTP(S) manifest and icon URLs. Replacing the
 * manifest with a blob URL or data-URL icons breaks Chromium's install flow
 * on some devices, even after it already offered `beforeinstallprompt`.
 *
 * Coordinates with `useFaviconBadge` via the shared `data-base-href`
 * attribute on each `<link rel="icon">`: the badge code prefers that
 * attribute over its own original-href snapshot, so the unread-count dot
 * always composites over the current dynamic base instead of stomping
 * back to the build-time SVG.
 */
export function useDynamicAppIcon(): void {
  const { theme, mode } = useTheme()

  useEffect(() => {
    if (typeof document === 'undefined') return
    let cancelled = false

    const primary = theme.primary
    const accent = theme.accent
    const chromeColor = mode.bg || FALLBACK_BG
    // ── Layer 1: favicon ─────────────────────────────────────────────────
    const faviconSvg = buildAppIconSvg({ primary, accent, mode: 'standard' })
    const faviconHref = svgToDataUrl(faviconSvg)
    const iconLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    )
    for (const link of iconLinks) {
      link.setAttribute('type', 'image/svg+xml')
      link.setAttribute('href', faviconHref)
      link.setAttribute(DYNAMIC_MARK, 'true')
      // Expose the live base href so `useFaviconBadge` composites its
      // unread-count dot over the dynamic icon, not the static build-time
      // SVG it captured at first paint.
      link.dataset.baseHref = faviconHref
    }

    // ── Theme-color metas (drive the browser toolbar tint) ─────────────
    // index.html ships one meta per OS color scheme so first paint is
    // correct before React hydrates. From here on the APP theme owns the
    // chrome, so every meta is re-tinted to the active surface — the OS
    // scheme no longer matters once the app is running.
    const themeColorMetas = Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
    )
    if (themeColorMetas.length === 0) {
      const created = document.createElement('meta')
      created.setAttribute('name', 'theme-color')
      document.head.appendChild(created)
      themeColorMetas.push(created)
    }
    for (const meta of themeColorMetas) {
      meta.setAttribute('content', chromeColor)
      meta.setAttribute(DYNAMIC_MARK, 'true')
    }

    // ── Layer 2: apple-touch-icon ────────────────────────────────────────
    // Fire-and-forget — iOS only reads this on "Add to Home Screen" so a
    // small render delay is harmless.
    const appleSvg = buildAppIconSvg({ primary, accent, mode: 'apple' })
    void renderSvgToPngDataUrl(appleSvg, 180).then((dataUrl) => {
      if (!dataUrl || cancelled) return
      const appleLinks = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'),
      )
      for (const link of appleLinks) {
        link.setAttribute('href', dataUrl)
        link.setAttribute(DYNAMIC_MARK, 'true')
      }
    })

    return () => {
      cancelled = true
    }
  }, [theme.primary, theme.accent, mode.bg])
}
