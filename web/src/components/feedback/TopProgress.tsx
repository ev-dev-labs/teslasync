import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { globalProgress } from '@/lib/globalProgress'

/**
 * Phase-46 / Prompt 07 — top-of-viewport progress bar.
 *
 * Subscribes to {@link globalProgress} and renders a slim 2 px strip
 * along the very top of the viewport while at least one consumer
 * (Suspense bridge, opt-in mutation) is active. Disappears once
 * `activeCount` returns to zero.
 *
 * Visual:
 *   - 2 px tall, full-width, fixed at top, z-60 so it sits above all
 *     banners, modals stay above (z-70+).
 *   - Cyan→indigo gradient using palette-tone classes so it never
 *     trips the neon-text or tooltip-text-color audits.
 *   - Width reflects the asymptotic trickle (0..80 %) plus the final
 *     snap-back to 0 on completion.
 *
 * Accessibility:
 *   - role="progressbar" with aria-valuemin / aria-valuemax /
 *     aria-valuenow + aria-label sourced from i18n.
 *   - Honors `prefers-reduced-motion`: the width transition is
 *     omitted (no smoothing), but the bar still appears so users
 *     keep the loading affordance.
 */
export function TopProgress() {
  const { t } = useTranslation()
  const { reduce } = useMotionPreference()

  const [active, setActive] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    return globalProgress.subscribe((nextActive, nextProgress) => {
      setActive(nextActive)
      setProgress(nextProgress)
    })
  }, [])

  if (!active) return null

  const valuenow = Math.round(Math.max(0, Math.min(100, progress)))

  return (
    <div
      role="progressbar"
      aria-label={t('global.loading', 'Loading')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valuenow}
      data-testid="top-progress"
      className={cn(
        'fixed top-0 left-0 right-0 z-[60] h-0.5 pointer-events-none',
        'bg-gradient-to-r from-cyan-400 via-indigo-400 to-emerald-400',
        'shadow-[0_0_8px_rgba(34,211,238,0.55)]',
        // Without reduced motion we transition the width smoothly so
        // the trickle reads as motion rather than a jumping bar.
        reduce ? null : 'transition-[width] duration-fast ease-linear',
      )}
      style={{ width: `${valuenow}%` }}
    />
  )
}
