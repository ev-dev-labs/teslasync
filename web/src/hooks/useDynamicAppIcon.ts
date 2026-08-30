import { useEffect, useRef } from 'react'
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
 * `<meta name="theme-color">` tag, AND the PWA manifest icons in real time.
 * The icon accent follows the chosen theme while browser chrome follows the
 * active surface mode, keeping both dark and light installs visually calm.
 *
 * Layer 1 — favicon (instant, every browser):
 *   Mutates every `<link rel="icon">` to a base64-encoded SVG data URL with
 *   the active framed brand mark. Inlines a `data-dynamic-app-icon`
 *   marker so `useFaviconBadge` knows it can re-snapshot the live href
 *   instead of restoring to the build-time default.
 *
 * Layer 2 — apple-touch-icon (best-effort, iOS install-time):
 *   Renders the apple variant SVG to a 180×180 PNG via canvas and pushes it
 *   into `<link rel="apple-touch-icon">`. Only takes effect when the user
 *   does "Add to Home Screen" — existing iOS installs are baked.
 *
 * Layer 3 — manifest (best-effort, Android install-time):
 *   Builds a synthetic Web App Manifest with rasterised maskable PNGs as
 *   data URLs and swaps `<link rel="manifest">` to a Blob URL. Chrome reads
 *   this for the install prompt, so the next "Install app" picks up the
 *   chosen theme. Existing Android installs keep their baked launcher icon.
 *
 * Coordinates with `useFaviconBadge` via the shared `data-base-href`
 * attribute on each `<link rel="icon">`: the badge code prefers that
 * attribute over its own original-href snapshot, so the unread-count dot
 * always composites over the current dynamic base instead of stomping
 * back to the build-time SVG.
 */
export function useDynamicAppIcon(): void {
  const { theme, mode } = useTheme()
  const lastBlobUrlRef = useRef<string | null>(null)
  const lastSignatureRef = useRef<string>('')

  useEffect(() => {
    if (typeof document === 'undefined') return

    const primary = theme.primary
    const accent = theme.accent
    const chromeColor = mode.bg || FALLBACK_BG
    const signature = `${primary}|${accent}|${chromeColor}`
    if (signature === lastSignatureRef.current) return
    lastSignatureRef.current = signature

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

    // ── Theme-color meta (drives Chrome URL bar tint on Android) ─────────
    let themeColorMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta')
      themeColorMeta.setAttribute('name', 'theme-color')
      document.head.appendChild(themeColorMeta)
    }
    themeColorMeta.setAttribute('content', chromeColor)
    themeColorMeta.setAttribute(DYNAMIC_MARK, 'true')

    // ── Layer 2: apple-touch-icon ────────────────────────────────────────
    // Fire-and-forget — iOS only reads this on "Add to Home Screen" so a
    // small render delay is harmless.
    const appleSvg = buildAppIconSvg({ primary, accent, mode: 'apple' })
    void renderSvgToPngDataUrl(appleSvg, 180).then((dataUrl) => {
      if (!dataUrl) return
      const appleLinks = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'),
      )
      for (const link of appleLinks) {
        link.setAttribute('href', dataUrl)
        link.setAttribute(DYNAMIC_MARK, 'true')
      }
    })

    // ── Layer 3: manifest icons ──────────────────────────────────────────
    // Generate maskable + standard rasters in parallel, assemble a Web App
    // Manifest blob, and replace the existing `<link rel="manifest">` href.
    // Chrome's install prompt re-reads the manifest each time it opens, so
    // this affects the next install. Existing installs keep their baked
    // launcher icon.
    const standardSvg = buildAppIconSvg({ primary, accent, mode: 'standard' })
    const maskableSvg = buildAppIconSvg({ primary, accent, mode: 'maskable' })

    Promise.all([
      renderSvgToPngDataUrl(standardSvg, 192),
      renderSvgToPngDataUrl(standardSvg, 512),
      renderSvgToPngDataUrl(maskableSvg, 192),
      renderSvgToPngDataUrl(maskableSvg, 512),
    ]).then(([std192, std512, msk192, msk512]) => {
      // If canvas isn't available (jsdom, sandboxed iframe) silently skip
      // — layers 1 + theme-color above have already done the visible work.
      if (!std192 || !std512 || !msk192 || !msk512) return

      const manifestLink = document.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]',
      )
      if (!manifestLink) return

      // Build a minimal manifest mirroring the static one in vite.config.ts
      // but with our data-URL icons. Anything not relevant to the install
      // prompt (shortcuts, screenshots) is omitted to keep the blob small.
      const manifest = {
        name: 'TeslaSync',
        short_name: 'TeslaSync',
        start_url: '/',
        display: 'standalone',
        background_color: chromeColor,
        theme_color: chromeColor,
        orientation: 'any',
        categories: ['auto', 'utilities'],
        icons: [
          { src: std192, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: std512, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: msk192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: msk512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }

      const blob = new Blob([JSON.stringify(manifest)], {
        type: 'application/manifest+json',
      })
      const url = URL.createObjectURL(blob)

      // Free the previous blob to avoid leaking when the user repeatedly
      // changes themes. The browser holds a strong reference to the
      // currently-linked manifest until the link href is overwritten, so
      // we revoke AFTER the swap.
      const previous = lastBlobUrlRef.current
      manifestLink.setAttribute('href', url)
      manifestLink.setAttribute(DYNAMIC_MARK, 'true')
      lastBlobUrlRef.current = url
      if (previous) URL.revokeObjectURL(previous)
    })
  }, [theme.primary, theme.accent, mode.bg])

  // Revoke the final manifest blob URL when the host component unmounts so
  // we don't leak across HMR cycles in dev or test re-mounts.
  useEffect(() => {
    return () => {
      const url = lastBlobUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        lastBlobUrlRef.current = null
      }
    }
  }, [])
}
