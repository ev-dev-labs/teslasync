import type { ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle, Info, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizeSeverity, severityTokens, type SeverityIconName } from '@/lib/tokens'

const iconMap: Record<SeverityIconName, LucideIcon> = {
  Info,
  AlertTriangle,
  AlertOctagon,
  CheckCircle,
}

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5 gap-1',
  md: 'text-sm px-2 py-1 gap-1.5',
} as const

const iconSizeClasses = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
} as const

export interface SeverityBadgeProps {
  /** Wire-level severity value. Anything is accepted — `normalizeSeverity` decides. */
  severity: string | null | undefined
  showIcon?: boolean
  size?: keyof typeof sizeClasses
  className?: string
  /** Optional override label. Defaults to the canonical severity name. */
  children?: ReactNode
  title?: string
}

export function SeverityBadge({
  severity,
  showIcon = true,
  size = 'md',
  className,
  children,
  title,
}: SeverityBadgeProps) {
  const sev = normalizeSeverity(severity)
  const tokens = severityTokens[sev]
  const Icon = iconMap[tokens.icon]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        tokens.bg,
        tokens.border,
        tokens.fg,
        sizeClasses[size],
        className,
      )}
      title={title}
    >
      {showIcon && <Icon className={iconSizeClasses[size]} aria-hidden="true" />}
      <span>{children ?? sev}</span>
    </span>
  )
}

export interface SeverityIconProps {
  severity: string | null | undefined
  className?: string
}

/** Renders just the canonical Lucide icon for a severity, colored via tokens. */
export function SeverityIcon({ severity, className }: SeverityIconProps) {
  const sev = normalizeSeverity(severity)
  const tokens = severityTokens[sev]
  const Icon = iconMap[tokens.icon]
  return <Icon className={cn(tokens.fg, className)} aria-hidden="true" />
}
