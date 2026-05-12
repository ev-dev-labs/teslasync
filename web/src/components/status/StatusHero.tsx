/**
 * StatusHero — large at-a-glance status card.
 *
 * Surfaces the answer to "is my instance healthy?" in <1 second.
 * Status drives icon, headline, ring colour, and (optionally) glow.
 *
 * Reusable across:
 *   - SystemStatusPage hero
 *   - Future incident pages
 *   - Embedded summaries on dashboards
 */

import { type ReactNode } from 'react'
import { CheckCircle, AlertTriangle, XCircle, HelpCircle, Wrench, RefreshCw } from 'lucide-react'
import { GlassPanel, Button } from '@/components/ui'
import { LiveIndicator } from '@/components/data-display'
import { cn } from '@/lib/cn'

export type HeroStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'

const STATUS_CONFIG: Record<HeroStatus, {
  icon: typeof CheckCircle
  ring: string
  bg: string
  text: string
  glowRgba: string
  defaultHeadline: string
}> = {
  healthy:     { icon: CheckCircle,  ring: 'ring-green-500/40',  bg: 'bg-green-500/15',  text: 'text-green-400',  glowRgba: 'rgba(34,197,94,0.35)',  defaultHeadline: 'All systems operational' },
  degraded:    { icon: AlertTriangle, ring: 'ring-amber-500/40', bg: 'bg-amber-500/15', text: 'text-amber-400', glowRgba: 'rgba(245,158,11,0.35)', defaultHeadline: 'Degraded performance' },
  unhealthy:   { icon: XCircle,      ring: 'ring-red-500/40',    bg: 'bg-red-500/15',    text: 'text-red-400',    glowRgba: 'rgba(239,68,68,0.35)',  defaultHeadline: 'Service outage' },
  unknown:     { icon: HelpCircle,   ring: 'ring-zinc-500/40',   bg: 'bg-zinc-500/15',   text: 'text-zinc-400',   glowRgba: 'rgba(113,113,122,0.25)', defaultHeadline: 'Status unknown' },
  maintenance: { icon: Wrench,       ring: 'ring-blue-500/40',   bg: 'bg-blue-500/15',   text: 'text-blue-400',   glowRgba: 'rgba(59,130,246,0.35)', defaultHeadline: 'Scheduled maintenance' },
}

export interface StatusHeroProps {
  status: HeroStatus
  /** Override headline text. Default depends on status. */
  headline?: string
  /** Sub-line shown beneath the headline. */
  subline?: ReactNode
  /** Show "Live" indicator dot when SSE / live updates are connected. */
  live?: boolean
  /** Optional CTA button (e.g. "Run health check"). */
  cta?: { label: string; onClick: () => void; loading?: boolean }
  /** Optional ID for in-page anchor / IntersectionObserver targeting. */
  id?: string
  className?: string
}

export function StatusHero({
  status,
  headline,
  subline,
  live = false,
  cta,
  id,
  className,
}: StatusHeroProps) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  const heading = headline ?? cfg.defaultHeadline

  return (
    <GlassPanel
      id={id}
      className={cn('p-4 md:p-5', className)}
      style={{ boxShadow: `0 0 60px ${cfg.glowRgba}` }}
    >
      <div className="flex flex-col items-center gap-4 text-center md:flex-row md:items-center md:gap-6 md:text-left">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-2',
            cfg.bg,
            cfg.ring,
          )}
          aria-hidden
        >
          <Icon className={cn('h-7 w-7', cfg.text)} />
        </div>

        <div
          className="flex-1 min-w-0 space-y-2"
          role="status"
          aria-live="polite"
        >
          <h2 className={cn('text-xl md:text-2xl font-bold leading-tight', cfg.text)}>
            {heading}
          </h2>
          {subline && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-[var(--text-secondary)] md:justify-start">
              {subline}
              {live && (
                <span className="inline-flex items-center gap-1.5">
                  <LiveIndicator variant="dot" />
                  <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Live</span>
                </span>
              )}
            </div>
          )}
        </div>

        {cta && (
          <div className="shrink-0">
            <Button
              variant="primary"
              size="md"
              onClick={cta.onClick}
              disabled={cta.loading}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', cta.loading && 'animate-spin')} />
              {cta.label}
            </Button>
          </div>
        )}
      </div>
    </GlassPanel>
  )
}
