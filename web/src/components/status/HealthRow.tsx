/**
 * HealthRow — compact health summary row.
 *
 * Renders an icon, label, summary text (e.g. "12 / 12 healthy"), and
 * a "View →" link. Status drives the dot colour. Use stacks of these
 * inside a panel as a high-density at-a-glance health grid.
 */

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button, BUTTON_BASE, BUTTON_VARIANTS } from '../ui/Button'
import { Text } from '../ui/Typography'
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
  healthy:     'text-emerald-300',
  degraded:    'text-amber-300',
  unhealthy:   'text-rose-300',
  unknown:     'text-[var(--text-muted)]',
  maintenance: 'text-indigo-300',
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
      <Text as="span" variant="bodySm" weight="medium" color="primary" className="min-w-0 flex-1 text-start [overflow-wrap:anywhere]">
        {label}
      </Text>
      <Text as="span" variant="caption" className={cn('min-w-0 max-w-[50%] [overflow-wrap:anywhere]', summaryClass)}>
        {summary}
      </Text>
      {(to || onClick) && (
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
      )}
    </>
  )

  const baseClasses = cn(
    'flex h-auto w-full items-center gap-3 rounded-lg px-3 py-3 text-start',
    'min-h-[44px]',
  )
  const linkClasses = cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, baseClasses)

  if (to) {
    if (external) {
      return (
        <a
          href={to}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClasses}
          aria-label={`${label} — ${summary}`}
        >
          {inner}
        </a>
      )
    }
    return (
      <Link to={to} className={linkClasses} aria-label={`${label} — ${summary}`}>
        {inner}
      </Link>
    )
  }

  if (onClick) {
    return (
      <Button type="button" variant="ghost" size="auto" onClick={onClick} className={baseClasses}>
        {inner}
      </Button>
    )
  }

  return <div className={baseClasses}>{inner}</div>
}
