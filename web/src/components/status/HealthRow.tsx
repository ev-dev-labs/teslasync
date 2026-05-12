/**
 * HealthRow — single-line health summary row.
 *
 * Renders an icon, label, summary text (e.g. "12 / 12 healthy"), and
 * a "View →" link. Status drives the dot colour. Use stacks of these
 * inside a panel as a high-density at-a-glance health grid.
 */

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { HeroStatus } from './StatusHero'

const DOT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy:     'bg-green-400',
  degraded:    'bg-amber-400',
  unhealthy:   'bg-red-400',
  unknown:     'bg-zinc-400',
  maintenance: 'bg-blue-400',
}

const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy:     'text-green-400',
  degraded:    'text-amber-400',
  unhealthy:   'text-red-400',
  unknown:     'text-zinc-400',
  maintenance: 'text-blue-400',
}

export interface HealthRowProps {
  status: HeroStatus
  icon?: ReactNode
  label: string
  /** Right-aligned summary (e.g. "12 / 12 healthy" or "0 vehicles · idle"). */
  summary: string
  /** Optional "View →" link. */
  to?: string
  /** External target — opens in new tab. Ignored if `to` is omitted. */
  external?: boolean
  /** Click handler when no link is provided. */
  onClick?: () => void
}

export function HealthRow({ status, icon, label, summary, to, external = false, onClick }: HealthRowProps) {
  const dotClass = DOT_FOR_STATUS[status]
  const summaryClass = TEXT_FOR_STATUS[status]

  const inner = (
    <>
      <span
        className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', dotClass)}
        aria-hidden
      />
      {icon && (
        <span className="shrink-0 text-[var(--text-secondary)]" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--text-primary)]">
        {label}
      </span>
      <span className={cn('shrink-0 text-xs', summaryClass)}>
        {summary}
      </span>
      {(to || onClick) && (
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
      )}
    </>
  )

  const baseClasses = cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left',
    'min-h-[44px]',
    (to || onClick) && 'transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
  )

  if (to) {
    if (external) {
      return (
        <a
          href={to}
          target="_blank"
          rel="noopener noreferrer"
          className={baseClasses}
          aria-label={`${label} — ${summary}`}
        >
          {inner}
        </a>
      )
    }
    return (
      <Link to={to} className={baseClasses} aria-label={`${label} — ${summary}`}>
        {inner}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClasses}>
        {inner}
      </button>
    )
  }

  return <div className={baseClasses}>{inner}</div>
}
