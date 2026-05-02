import { cn } from '@/lib/cn'
import { normalizeSeverity, severityTokens } from '@/lib/tokens'

export interface StatusDotProps {
  severity: string | null | undefined
  className?: string
  /** Optional accessible label describing the dot's meaning. */
  label?: string
}

/** Tiny colored dot for inline status indication (e.g. unread alert markers). */
export function StatusDot({ severity, className, label }: StatusDotProps) {
  const sev = normalizeSeverity(severity)
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', severityTokens[sev].dot, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
