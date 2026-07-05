/**
 * Shared presentation tokens + helpers for the per-incident timeline surface.
 * Kept framework-light so the page orchestrator and its sub-components render
 * incident severity/status consistently (DRY — used in 3+ places).
 */
import { useCallback, useMemo } from 'react'
import { AlertCircle, AlertTriangle, AlertOctagon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type NeonColor } from '@/lib/tokens'
import { type IncidentSeverity, type IncidentStatus } from '@/api/hooks/useIncidents'

export type IncidentBadgeVariant = 'warning' | 'danger' | 'info' | 'success'

/** Severity chip icon + tinted chip classes (bg + border + toned 300-level text). */
export const SEVERITY_TONE: Record<IncidentSeverity, { Icon: typeof AlertCircle; chip: string }> = {
  minor:    { Icon: AlertCircle,   chip: 'bg-amber-500/10 border-amber-500/30 text-amber-300' },
  major:    { Icon: AlertTriangle, chip: 'bg-orange-500/10 border-orange-500/30 text-orange-300' },
  critical: { Icon: AlertOctagon,  chip: 'bg-rose-500/10 border-rose-500/30 text-rose-300' },
}

export const STATUS_BADGE: Record<IncidentStatus, IncidentBadgeVariant> = {
  investigating: 'danger',
  identified:    'warning',
  monitoring:    'info',
  resolved:      'success',
}

export const STATUS_COLOR: Record<IncidentStatus, NeonColor> = {
  investigating: 'red',
  identified:    'amber',
  monitoring:    'cyan',
  resolved:      'green',
}

/** Human "1h 5m" style duration between two ISO instants (end defaults to now). */
export function fmtDuration(startIso: string, endIso?: string): string {
  const s = Date.parse(startIso)
  const e = endIso ? Date.parse(endIso) : Date.now()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return ''
  const secs = Math.max(0, Math.floor((e - s) / 1000))
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`
}

/**
 * i18n-aware status → label resolver.
 *
 * The label table is memoised on `t` (recomputed only when the active language
 * changes) and the returned resolver is a stable reference across renders, so
 * callers can safely use it inside `.map()` loops and pass it to memoised
 * children without forcing re-renders. Unknown statuses fall back to the raw
 * value so a future enum member never renders blank.
 */
export function useIncidentStatusLabel(): (s: IncidentStatus) => string {
  const { t } = useTranslation()
  const labels = useMemo<Record<IncidentStatus, string>>(
    () => ({
      investigating: t('incidentTimeline.status.investigating', 'Investigating'),
      identified:    t('incidentTimeline.status.identified', 'Identified'),
      monitoring:    t('incidentTimeline.status.monitoring', 'Monitoring'),
      resolved:      t('incidentTimeline.status.resolved', 'Resolved'),
    }),
    [t],
  )
  return useCallback((s: IncidentStatus): string => labels[s] ?? s, [labels])
}
