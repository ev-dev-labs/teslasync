/**
 * Active-incidents block on /system-status.
 * Renders above the chip bar when one or more incidents are active.
 * Each row is a compact summary; clicking opens the post-mortem
 * timeline page at /system-status/incidents/:id.
 * Empty state: when a successful read confirms no active incidents, the
 * supplementary card collapses. Past incidents live in History below
 * the chip bar.
 * "Log incident" CTA opens the IncidentForm dialog so operators can
 * record manual incidents (e.g., "Wall connector restart at 14:00").
 */

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, AlertOctagon, Plus, ChevronRight } from 'lucide-react'
import { GlassPanel, Button, Badge, PanelTitle, Text, Caption } from '@/components/ui'
import { SourceContent } from '@/components/layout'
import { StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import { cn } from '@/lib/cn'
import {
  useIncidents,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/api/hooks/useIncidents'
import { IncidentForm } from './IncidentForm'

const SEVERITY_TONE: Record<IncidentSeverity, { Icon: typeof AlertCircle; cls: string; label: string }> = {
  minor:    { Icon: AlertCircle,   cls: 'text-amber-300',  label: 'minor' },
  major:    { Icon: AlertTriangle, cls: 'text-orange-300', label: 'major' },
  critical: { Icon: AlertOctagon,  cls: 'text-rose-300',   label: 'critical' },
}

// Fallback tone for a severity outside the known enum. The API contract types
// `severity` as a closed union, but a Go backend that adds a new level (or
// serialises an empty string) would otherwise resolve the lookup to
// `undefined` and crash the row on `const { Icon } = tone`.
const FALLBACK_TONE = { Icon: AlertCircle, cls: 'text-[var(--text-muted)]', label: 'unknown' } as const

const STATUS_BADGE: Record<IncidentStatus, 'warning' | 'danger' | 'info' | 'success'> = {
  investigating: 'danger',
  identified:    'warning',
  monitoring:    'info',
  resolved:      'success',
}

function relativeFrom(now: number, iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const secs = Math.max(0, Math.floor((now - t) / 1000))
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

interface IncidentsCardProps {
  /** "now" tick from the page so relative timestamps re-render. */
  now: number
}

export function IncidentsCard({ now }: IncidentsCardProps) {
  const { t } = useTranslation()
  const query = useIncidents({ activeOnly: true })
  const { data: active } = query
  const state = useDataState(query)
  const [open, setOpen] = useState(false)
  const incidents = useMemo<Incident[]>(() => active?.incidents ?? [], [active])

  const openForm = useCallback(() => setOpen(true), [])
  const closeForm = useCallback(() => setOpen(false), [])

  if (state.hasData && state.status === 'ok' && incidents.length === 0 && !open) {
    return null
  }

  return (
    <GlassPanel className="p-3 ring-1 ring-amber-400/30 bg-amber-500/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-2">
        <PanelTitle as="h3" className="inline-flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {t('systemStatus.incidents.active', 'Active incidents')}
          <Badge variant="warning">{state.hasData ? incidents.length : '—'}</Badge>
        </PanelTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          wrapLabel
          onClick={openForm}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('systemStatus.incidents.logAction', 'Log incident')}
        </Button>
      </div>
      <StaleRefreshWarning state={state} label={t('systemStatus.incidents.active', 'Active incidents')} />
      <SourceContent
        state={state.fatalError ? 'error' : !state.hasData ? 'loading' : incidents.length === 0 ? 'empty' : 'ready'}
        label={t('systemStatus.incidents.active', 'Active incidents')}
        emptyMessage={t('systemStatus.incidents.empty', 'No active incidents recorded.')}
        errorMessage={t('systemStatus.incidents.loadError', 'Unable to load active incidents.')}
        error={state.fatalError}
        errorRecovery={state.retry ? { onRetry: state.retry } : undefined}
      >
      <ul className="space-y-1" aria-label={t('systemStatus.incidents.active', 'Active incidents')}>
        {incidents.map((inc) => {
          const tone = SEVERITY_TONE[inc.severity] ?? FALLBACK_TONE
          const { Icon } = tone
          const components = inc.affected_components ?? []
          const updateCount = (inc.updates ?? []).length
          return (
            <li key={inc.id}>
              <Link
                to={`/system-status/incidents/${inc.id}`}
                className="flex items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              >
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', tone.cls)} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="span" variant="bodySm" weight="medium" className="break-words">{inc.title || t('systemStatus.incidentHistory.untitled', 'Untitled incident')}</Text>
                    <Badge variant={STATUS_BADGE[inc.status] ?? 'neutral'}>{inc.status}</Badge>
                    <Caption as="span" className={tone.cls}>{tone.label}</Caption>
                  </div>
                  {components.length > 0 && (
                    <Caption as="div" className="mt-0.5 break-words">
                      {t('systemStatus.incidents.affects', 'Affects')}: {components.join(', ')}
                    </Caption>
                  )}
                  <Caption as="div" className="mt-0.5">
                    {t('systemStatus.incidents.started', 'Started')} {relativeFrom(now, inc.started_at)}
                    {updateCount > 1 && ` · ${updateCount} ${t('updates')}`}
                  </Caption>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-1" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
      </SourceContent>
      {open && <IncidentForm onClose={closeForm} />}
    </GlassPanel>
  )
}
