import { type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'

interface MetricCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  color?: NeonColor
  change?: { value: string; positive: boolean }
  subtitle?: string
  className?: string
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({ label, value, icon, color = 'cyan', change, subtitle, className }: MetricCardProps) {
  const c = neonColorMap[color]
  return (
    <div className={cn('p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] transition-colors hover:border-white/[0.08]', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1 text-[10px] truncate">{label}</p>
          <p className="text-xl font-bold tracking-tight text-[var(--text-primary)]">{value}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-[var(--text-muted)] truncate">{subtitle}</p>}
          {change && (
            <p className={cn('mt-1 text-[10px] font-medium', change.positive ? 'text-emerald-300' : 'text-rose-300')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </p>
          )}
        </div>
        {icon && (
          <div className={cn('flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0', c.bg, c.ring)}>
            <div className={c.text}>{icon}</div>
          </div>
        )}
      </div>
    </div>
  )
}
