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
  // A labelled dot is exposed as a meaningful graphic; an unlabelled (or
  // empty-string) dot is decorative and hidden from assistive tech. Drive all
  // three ARIA attributes off the same check so an empty label can't leak a
  // meaningless `aria-label=""` onto an otherwise-hidden node.
  const hasLabel = Boolean(label)
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', severityTokens[sev].dot, className)}
      role={hasLabel ? 'img' : undefined}
      aria-label={hasLabel ? label : undefined}
      aria-hidden={hasLabel ? undefined : true}
    />
  )
}
