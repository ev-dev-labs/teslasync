import { type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Text } from '@/components/ui/Typography'

export interface TimelineItemProps {
  /** Leading glyph rendered inside the accent swatch. Decorative — the visible
   *  title carries the accessible name, so the swatch is `aria-hidden`. */
  icon?: ReactNode
  /** Primary line. Truncated to a single line unless `wrap` is enabled. */
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
  /** Whole-row navigation by default; with metadata/actions only the title
   *  is linked, keeping caller-supplied interactive content outside the link. */
  href?: string
  /** Optional semantic badges/chips (status, severity, provenance) rendered
   *  in a wrapped row beneath the subtitle. */
  badges?: ReactNode
  /** Caller-formatted details; may include interactive content. */
  metadata?: ReactNode
  /** Caller-owned actions, never nested inside the navigation link. */
  actions?: ReactNode
  /** Allow long titles and details to wrap in narrow feed containers. */
  wrap?: boolean
}

/** Timeline presentation only; ordering, timestamps and actions belong to callers. */
export function TimelineItem({
  icon, title, subtitle, time, color, isLast, href, badges, metadata, actions, wrap = false,
}: TimelineItemProps) {
  // Guard the accent so a missing/blank colour cannot produce an invalid
  // `undefined15` inline value — fall back to a neutral theme surface instead.
  const hasColor = typeof color === 'string' && color.trim().length > 0
  const swatchStyle: CSSProperties | undefined = hasColor
    ? { backgroundColor: `${color}15`, color }
    : undefined

  const hasRichSlots = metadata != null || actions != null
  const linkClassName = 'rounded-md hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60 transition-colors'
  const titleContent = (
    <Text as="p" size="sm" weight="medium" color="primary" className={cn(wrap ? 'whitespace-normal break-words [overflow-wrap:anywhere]' : 'truncate')}>
      {title || '—'}
    </Text>
  )

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
        {href && hasRichSlots ? (
          <Link to={href} className={cn('block min-w-0', linkClassName)}>{titleContent}</Link>
        ) : titleContent}
        {subtitle ? <Text as="p" size="xs" color="muted" className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{subtitle}</Text> : null}
        {badges ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5 min-w-0 break-words [overflow-wrap:anywhere]">{badges}</div> : null}
        {metadata != null ? (
          <Text as="div" variant="bodySm" className="mt-1.5 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{metadata}</Text>
        ) : null}
        <Text as="p" size="2xs" color="muted" className="mt-1 break-words [overflow-wrap:anywhere]">{time || '—'}</Text>
        {actions != null ? <div className="mt-1.5 flex flex-wrap items-center gap-2 min-w-0 break-words [overflow-wrap:anywhere]">{actions}</div> : null}
      </div>
    </>
  )
  if (href && !hasRichSlots) {
    return (
      <Link
        to={href}
        className={cn('flex gap-3 -mx-1 px-1', linkClassName)}
      >
        {body}
      </Link>
    )
  }
  return <div className="flex gap-3">{body}</div>
}
