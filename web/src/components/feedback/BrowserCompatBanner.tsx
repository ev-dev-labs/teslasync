import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { AlertBanner } from './AlertBanner'
import {
  detectMissingFeatures,
  dismissCompatWarning,
  isCompatWarningDismissed,
} from '@/lib/browserCompat'

/**
 * Phase-46 / Prompt 63 — Browser compatibility warning banner.
 *
 * Renders a one-time, sticky top-of-page warning when the host browser
 * is missing one or more web-platform features TeslaSync depends on
 * (BroadcastChannel, ResizeObserver, Intl.RelativeTimeFormat,
 * crypto.randomUUID, CSS `:has()`, structuredClone). On unsupported
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
 * Mounted in <Layout> ABOVE ServiceStatusBanner so the banner is the
 * first thing inside `<main>`. It is intentionally NOT placed before
 * the SkipToContent link (Phase-46 / Prompt 60) — keyboard users must
 * still hit the skip-link first.
 */

const RECOMMENDED_BROWSERS_FALLBACK =
  'Use Chrome ≥ 110, Edge ≥ 110, Firefox ≥ 109, or Safari ≥ 16.'

interface BrowserCompatBannerProps {
  /**
   * Test seam — overrides the live detection result so spec files can
   * exercise the rendered output without monkey-patching every global
   * at once. Production callers never set this.
   */
  testHookMissing?: string[]
}

export function BrowserCompatBanner({ testHookMissing }: BrowserCompatBannerProps = {}) {
  const { t } = useTranslation()

  const [missing, setMissing] = useState<string[]>(() =>
    testHookMissing ?? detectMissingFeatures(),
  )
  const [dismissed, setDismissed] = useState<boolean>(() => isCompatWarningDismissed())

  // Re-detect when the test seam changes — production callers never
  // pass it so this effect is a no-op outside specs.
  useEffect(() => {
    if (testHookMissing) {
      setMissing(testHookMissing)
    }
  }, [testHookMissing])

  const handleDismiss = useCallback(() => {
    dismissCompatWarning()
    setDismissed(true)
  }, [])

  if (dismissed || missing.length === 0) return null

  const featureList = missing.join(', ')
  const title = t('compat.banner.title', 'Your browser is missing required features')
  const body = t(
    'compat.banner.body',
    'TeslaSync needs {{features}} to work correctly. {{recommendation}}',
    { features: featureList, recommendation: RECOMMENDED_BROWSERS_FALLBACK },
  )

  // Keyed off `t(compat.banner.dismiss)` so the X button gets a
  // localized aria-label even though the underlying AlertBanner
  // currently omits one — once AlertBanner gains a per-instance
  // dismissLabel prop this wrapper can be flattened.
  return (
    <div
      data-testid="browser-compat-banner"
      data-missing={featureList}
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[55] px-4 py-2"
    >
      <AlertBanner
        variant="warning"
        title={title}
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        onClose={handleDismiss}
      >
        <span data-testid="browser-compat-banner-body">{body}</span>
      </AlertBanner>
    </div>
  )
}

export default BrowserCompatBanner
