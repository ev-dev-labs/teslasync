/**
 * Severity status pill for an incident: leading icon + tinted chip
 * (bg + border + toned 300-level text). Encapsulates the severity styling so
 * pages never hand-roll the pill utilities.
 */
import { cn } from '@/lib/cn'
import { type IncidentSeverity } from '@/api/hooks/useIncidents'
import { SEVERITY_TONE } from './incidentPresentation'

interface IncidentSeverityChipProps {
  severity: IncidentSeverity
  className?: string
}

export function IncidentSeverityChip({ severity, className }: IncidentSeverityChipProps) {
  const tone = SEVERITY_TONE[severity] ?? SEVERITY_TONE.minor
  const Icon = tone.Icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
        tone.chip,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {severity}
    </span>
  )
}
