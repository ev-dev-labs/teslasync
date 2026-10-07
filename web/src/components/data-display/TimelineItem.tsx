import { type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

export interface TimelineItemProps {
  /** Leading glyph rendered inside the accent swatch. Decorative — the visible
   *  title carries the accessible name, so the swatch is `aria-hidden`. */
  icon?: ReactNode
  /** Primary line. Truncated to a single line. */
  title: string
  /** Optional secondary line. */
  subtitle?: string
  /** Relative or absolute timestamp label (e.g. `2m ago`). */
  time: string
  /** Hex accent for the icon swatch (e.g. `#00f0ff`). When omitted the swatch
   *  falls back to a neutral theme surface rather than an invalid colour. */
  color?: string
  /** Hides the trailing connector line for the last row in a feed. */
  isLast?: boolean
  /** When provided, the entire row becomes a navigable `<Link>` for
   *  alert drill-through. */
  href?: string
  /** Optional semantic badges/chips (status, severity, provenance) rendered
   *  in a wrapped row beneath the subtitle. */
  badges?: ReactNode
}

/** Timeline item for activity feeds. When `href` is provided, the entire row
 *  becomes a navigable link for alert drill-through. */
export function TimelineItem({ icon, title, subtitle, time, color, isLast, href, badges }: TimelineItemProps) {
  // Guard the accent so a missing/blank colour cannot produce an invalid
  // `undefined15` inline value — fall back to a neutral theme surface instead.
  const hasColor = typeof color === 'string' && color.trim().length > 0
  const swatchStyle: CSSProperties | undefined = hasColor
    ? { backgroundColor: `${color}15`, color }
    : undefined

  const body = (
    <>
      <div className="flex flex-col items-center">
        <div
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
            !hasColor && 'bg-[var(--surface-2)] text-[var(--text-muted)]',
          )}
          style={swatchStyle}
        >
          {icon}
        </div>
        {!isLast && <div aria-hidden="true" className="w-px flex-1 bg-[var(--surface-2)] mt-1" />}
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{title || '—'}</p>
        {subtitle ? <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p> : null}
        {badges ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        <p className="text-2xs text-[var(--text-muted)] mt-1">{time || '—'}</p>
      </div>
    </>
  )
  if (href) {
    return (
      <Link
        to={href}
        className="flex gap-3 -mx-1 px-1 rounded-md hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60 transition-colors"
      >
        {body}
      </Link>
    )
  }
  return <div className="flex gap-3">{body}</div>
}
