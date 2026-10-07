import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'

import { cn } from '@/lib/cn'
import { DEMO_MODE_LABEL, isDemoModeEnabled } from '@/lib/demoMode'

/**
 * Unmistakable demo-mode label (HELP-12).
 *
 * Renders nothing unless demo mode is fully and explicitly configured — see
 * `lib/demoMode` for the fail-closed guard. When it does render it is:
 *
 *  - **Not dismissible.** A dismissed warning is an absent warning, and the
 *    entire point is that nobody screenshots synthetic degradation data and
 *    files a warranty claim with it.
 *  - **Persistent and top-of-viewport**, so it is captured by any screenshot
 *    of the app.
 *  - **Announced.** `role="status"` with `aria-live="polite"` so a screen
 *    reader user is told the data is synthetic too.
 */
export interface DemoModeBannerProps {
  className?: string
  /** Test seam — overrides the environment-derived state. */
  enabled?: boolean
}

export function DemoModeBanner({ className, enabled }: DemoModeBannerProps) {
  const { t } = useTranslation()
  const active = enabled ?? isDemoModeEnabled()
  if (!active) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-mode-banner"
      className={cn(
        'sticky top-0 z-[9999] flex items-center justify-center gap-2 border-b',
        'border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-center',
        'text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-100',
        className,
      )}
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{t('demoMode.label', DEMO_MODE_LABEL)}</span>
    </div>
  )
}
