/**
 * StickyCompactHero — collapsed-on-scroll hero bar.
 *
 * Watches a target element (the full hero) via IntersectionObserver
 * and only renders the compact bar once that target has scrolled
 * out of view. Tap → smooth-scrolls back to the top of the page.
 */

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle, AlertTriangle, XCircle, HelpCircle, Wrench, ArrowUp, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { HeroStatus } from './StatusHero'

const ICON_FOR_STATUS: Record<HeroStatus, typeof CheckCircle> = {
  healthy: CheckCircle,
  degraded: AlertTriangle,
  unhealthy: XCircle,
  unknown: HelpCircle,
  maintenance: Wrench,
}

const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: 'text-green-400',
  degraded: 'text-amber-400',
  unhealthy: 'text-red-400',
  unknown: 'text-zinc-400',
  maintenance: 'text-blue-400',
}

const SHORT_HEADLINE: Record<HeroStatus, string> = {
  healthy: 'All operational',
  degraded: 'Degraded',
  unhealthy: 'Outage',
  unknown: 'Status unknown',
  maintenance: 'Maintenance',
}

export interface StickyCompactHeroProps {
  /** ID of the full hero element to observe. */
  targetId: string
  status: HeroStatus
  /** Last-checked relative label, e.g. "12s ago". */
  lastCheckedLabel?: string
  onRefresh?: () => void
  refreshing?: boolean
  /** Pixel offset from the top of the viewport when stuck. */
  topOffset?: number
}

export function StickyCompactHero({
  targetId,
  status,
  lastCheckedLabel,
  onRefresh,
  refreshing = false,
  topOffset = 0,
}: StickyCompactHeroProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const target = document.getElementById(targetId)
    if (!target) return

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: `-${topOffset}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [targetId, topOffset])

  const handleScrollTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  if (!visible) return null

  const Icon = ICON_FOR_STATUS[status]
  const text = TEXT_FOR_STATUS[status]
  const headline = SHORT_HEADLINE[status]

  return (
    <div
      className="sticky z-40 -mx-4 border-b border-white/[0.06] bg-[var(--bg-1)]/95 backdrop-blur"
      style={{ top: topOffset }}
      role="region"
      aria-label="Status summary"
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={handleScrollTop}
          className="flex flex-1 items-center gap-2 text-left transition-colors hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded"
          aria-label="Scroll to top of page"
        >
          <Icon className={cn('h-4 w-4 shrink-0', text)} />
          <span className={cn('text-sm font-semibold', text)}>{headline}</span>
          {lastCheckedLabel && (
            <span className="text-xs text-[var(--text-muted)]">· {lastCheckedLabel}</span>
          )}
          <ArrowUp className="ml-auto h-3.5 w-3.5 text-[var(--text-muted)]" />
        </button>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh status"
            className={cn(
              'shrink-0 rounded-md p-2 text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)]',
              'min-h-[36px] min-w-[36px] flex items-center justify-center',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
              refreshing && 'opacity-60',
            )}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
        )}
      </div>
    </div>
  )
}
