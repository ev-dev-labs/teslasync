/**
 * ActionItem — single operator task row.
 *
 * Used inside ActionItemsPanel. Surfaces a thing the operator should
 * do (run backup, re-auth, install update). Severity drives colour;
 * an optional CTA renders as a primary button on the right.
 */

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ActionSeverity = 'info' | 'warn' | 'error'

const SEVERITY_CFG: Record<ActionSeverity, { icon: typeof AlertTriangle; text: string; bg: string; ring: string }> = {
  info:  { icon: Info,           text: 'text-blue-400',  bg: 'bg-blue-500/10',  ring: 'ring-blue-400/20' },
  warn:  { icon: AlertTriangle,  text: 'text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-400/20' },
  error: { icon: AlertCircle,    text: 'text-red-400',   bg: 'bg-red-500/10',   ring: 'ring-red-400/20' },
}

export interface ActionItemProps {
  severity: ActionSeverity
  title: string
  /** Sub-line beneath the title (e.g. "v1.2.0 → v1.3.0"). */
  description?: ReactNode
  /** CTA: either a route via `to` or a click handler. Renders as right-aligned button. */
  cta?: { label: string; to?: string; external?: boolean; onClick?: () => void }
}

export function ActionItem({ severity, title, description, cta }: ActionItemProps) {
  const cfg = SEVERITY_CFG[severity]
  const Icon = cfg.icon

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg p-3 ring-1',
        cfg.bg,
        cfg.ring,
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', cfg.text)} aria-hidden />

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
        {description && (
          <div className="text-xs text-[var(--text-secondary)]">{description}</div>
        )}
      </div>

      {cta && (
        <ActionCTA cta={cta} severityText={cfg.text} />
      )}
    </div>
  )
}

function ActionCTA({ cta, severityText }: { cta: NonNullable<ActionItemProps['cta']>; severityText: string }) {
  const baseClasses = cn(
    'inline-flex items-center gap-1 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium',
    'min-h-[36px] transition-colors hover:bg-[var(--surface-2)]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
    severityText,
  )

  if (cta.to) {
    if (cta.external) {
      return (
        <a href={cta.to} target="_blank" rel="noopener noreferrer" className={baseClasses}>
          {cta.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </a>
      )
    }
    return (
      <Link to={cta.to} className={baseClasses}>
        {cta.label}
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    )
  }

  if (cta.onClick) {
    return (
      <button type="button" onClick={cta.onClick} className={baseClasses}>
        {cta.label}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    )
  }

  return null
}
