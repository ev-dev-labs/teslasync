/**
 * Severity status pill for an incident: leading icon + tinted chip
 * (bg + border + toned 300-level text). Encapsulates the severity styling so
 * pages never hand-roll the pill utilities.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { type IncidentSeverity } from '@/api/hooks/useIncidents'
import { SEVERITY_TONE } from './incidentPresentation'

interface IncidentSeverityChipProps {
  severity: IncidentSeverity
  className?: string
}

/**
 * i18n key + English fallback for each canonical severity. Mirrors the sibling
 * `useIncidentStatusLabel` so severity reads through the same localisation path
 * the status badge on the incident page already uses (consistency + a11y).
 */
const SEVERITY_I18N: Record<IncidentSeverity, { key: string; fallback: string }> = {
  minor:    { key: 'incidentTimeline.severity.minor', fallback: 'Minor' },
  major:    { key: 'incidentTimeline.severity.major', fallback: 'Major' },
  critical: { key: 'incidentTimeline.severity.critical', fallback: 'Critical' },
}

export function IncidentSeverityChip({ severity, className }: IncidentSeverityChipProps) {
  const { t } = useTranslation()
  // Tone falls back to `minor` for any value outside the canonical union so a
  // malformed API severity still renders a coloured pill rather than crashing.
  const tone = SEVERITY_TONE[severity] ?? SEVERITY_TONE.minor
  const Icon = tone.Icon
  // Match the tone's defensiveness on the label: localise known severities,
  // surface an unexpected raw value verbatim, and never render an empty chip.
  const meta = SEVERITY_I18N[severity]
  const label = meta ? t(meta.key, meta.fallback) : (severity || '—')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 uppercase tracking-wide',
        typography.size.xs,
        typography.weight.semibold,
        tone.chip,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}
