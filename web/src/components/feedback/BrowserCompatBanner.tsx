import { lazy, Suspense, useState } from 'react'
import {
  detectMissingFeatures,
  dismissCompatWarning,
  isCompatWarningDismissed,
} from '@/lib/browserCompat'
import { ErrorBoundary } from './ErrorBoundary'

const BrowserCompatWarning = lazy(() => import('./BrowserCompatWarning'))

/**
 * Browser compatibility warning banner.
 *
 * Renders a one-time, sticky top-of-page warning when the host browser
 * is missing one or more web-platform features TeslaSync depends on
 * (BroadcastChannel, ResizeObserver, Intl.RelativeTimeFormat,
 * CSS `:has()`, structuredClone). On unsupported
 * browsers the SPA otherwise renders a white page or partial UI with
 * no diagnostic — this banner exists so the user gets a coherent
 * "update your browser" message instead of an opaque break.
 *
 * Detection is performed once on mount via {@link detectMissingFeatures}.
 * Re-running on prop changes is unnecessary because the host browser's
 * capabilities cannot change inside a single page load. Persisted
 * dismissal lives in localStorage under
 * `teslasync:compat-warning-dismissed:v1` so a user who has
 * acknowledged the warning is not nagged on every navigation.
 *
 * Mounted in <Layout> above ServiceStatusBanner so the banner is the first
 * thing inside `<main>`. It is intentionally not placed before the
 * SkipToContent link; keyboard users must still hit the skip-link first.
 */

interface BrowserCompatBannerProps {
  /**
   * Test seam — overrides the live detection result so spec files can
   * exercise the rendered output without monkey-patching every global
   * at once. Production callers never set this.
   */
  testHookMissing?: string[]
}

export function BrowserCompatBanner({ testHookMissing }: BrowserCompatBannerProps = {}) {
  const [detected] = useState(() => testHookMissing ?? detectMissingFeatures())
  const [dismissed, setDismissed] = useState(isCompatWarningDismissed)
  const missing = testHookMissing ?? detected

  function handleDismiss() {
    dismissCompatWarning()
    setDismissed(true)
  }

  if (dismissed || missing.length === 0) return null

  return (
    <ErrorBoundary name="Browser compatibility warning" inline>
      <Suspense fallback={null}>
        <BrowserCompatWarning missing={missing} onDismiss={handleDismiss} />
      </Suspense>
    </ErrorBoundary>
  )
}

export default BrowserCompatBanner
