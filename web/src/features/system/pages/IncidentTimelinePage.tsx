/**
 * IncidentTimelinePage — Phase-2 post-mortem page at
 * /system-status/incidents/:id.
 *
 * Operator UX:
 *   • Header: title, severity, status badge, lifecycle controls
 *   • Body: full timeline of updates (newest first)
 *   • Footer form: append a new update (auto-bumps "updated_at")
 *   • Resolve button: flips status to "resolved" + appends a
 *     "Incident resolved." line — requires confirm
 *
 * The page deliberately does NOT delete; resolving is the canonical
 * close-out. A separate admin-only delete CTA could be added later.
 */

import { useMemo, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, AlertCircle, AlertOctagon,
  CheckCircle2, Clock, MessageSquare,
} from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, Badge, Textarea, ConfirmDialog, Select } from '@/components/ui'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import {
  useIncident,
  useAppendIncidentUpdate,
  usePatchIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/api/hooks/useIncidents'

const SEVERITY_TONE: Record<IncidentSeverity, { Icon: typeof AlertCircle; cls: string }> = {
  minor:    { Icon: AlertCircle,   cls: 'text-amber-300' },
  major:    { Icon: AlertTriangle, cls: 'text-orange-300' },
  critical: { Icon: AlertOctagon,  cls: 'text-red-400' },
}

const STATUS_BADGE: Record<IncidentStatus, 'warning' | 'danger' | 'info' | 'success'> = {
  investigating: 'danger',
  identified:    'warning',
  monitoring:    'info',
  resolved:      'success',
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified:    'Identified',
  monitoring:    'Monitoring',
  resolved:      'Resolved',
}

function fmtAbs(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString()
}

function fmtDuration(startIso: string, endIso?: string): string {
  const s = Date.parse(startIso)
  const e = endIso ? Date.parse(endIso) : Date.now()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return ''
  const secs = Math.max(0, Math.floor((e - s) / 1000))
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`
}

export default function IncidentTimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const numericId = useMemo(() => {
    const n = Number(id)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [id])

  const { data: incident, isLoading, error } = useIncident(numericId)
  const appendUpdate = useAppendIncidentUpdate()
  const patch = usePatchIncident()

  const [message, setMessage] = useState('')
  const [nextStatus, setNextStatus] = useState<IncidentStatus | ''>('')
  const [confirmResolve, setConfirmResolve] = useState(false)

  const handleAppend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!incident) return
    const m = message.trim()
    if (!m) {
      toast.error('Update message is required.')
      return
    }
    try {
      await appendUpdate.mutateAsync({
        id: incident.id,
        payload: { message: m, status: (nextStatus || undefined) as IncidentStatus | undefined },
      })
      setMessage('')
      setNextStatus('')
      toast.success('Update added.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to append update')
    }
  }

  const handleResolve = async () => {
    if (!incident) return
    try {
      await patch.mutateAsync({ id: incident.id, payload: { resolved: true } })
      toast.success('Incident resolved.')
      setConfirmResolve(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve')
    }
  }

  if (isLoading) {
    return (
      <PageContainer title="Incident" subtitle="Loading…">
        <div className="text-sm text-[var(--text-muted)]">Loading incident…</div>
      </PageContainer>
    )
  }

  if (error || !incident) {
    return (
      <PageContainer title="Incident" subtitle="Not found">
        <GlassPanel className="p-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Incident {id} not found or you don't have access.
          </p>
          <div className="pt-3">
            <Link to="/system-status" className="text-sm text-cyan-300 hover:underline inline-flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to System Status
            </Link>
          </div>
        </GlassPanel>
      </PageContainer>
    )
  }

  const tone = SEVERITY_TONE[incident.severity]
  const { Icon } = tone
  const isResolved = incident.status === 'resolved'

  return (
    <PageContainer
      title={incident.title}
      subtitle={`Incident #${incident.id}`}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate('/system-status')} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      }
    >
      <div className="space-y-5 max-w-3xl mx-auto">
        <GlassPanel className="p-4">
          <div className="flex items-start gap-3">
            <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', tone.cls)} aria-hidden />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[incident.status]}>{STATUS_LABEL[incident.status]}</Badge>
                <span className={cn('text-xs uppercase tracking-wide', tone.cls)}>{incident.severity}</span>
                <span className="text-xs text-[var(--text-muted)]">{incident.source}</span>
                {isResolved ? (
                  <Badge variant="success">Resolved · {fmtDuration(incident.started_at, incident.resolved_at)}</Badge>
                ) : (
                  <Badge variant="neutral">Open · {fmtDuration(incident.started_at)}</Badge>
                )}
              </div>
              {incident.description && (
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{incident.description}</p>
              )}
              {incident.affected_components.length > 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  Affects: {incident.affected_components.join(', ')}
                </p>
              )}
              <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                Started {fmtAbs(incident.started_at)}
                {incident.resolved_at && ` · Resolved ${fmtAbs(incident.resolved_at)}`}
              </p>
            </div>
            {!isResolved && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setConfirmResolve(true)}
                disabled={patch.isPending}
                className="gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolve
              </Button>
            )}
          </div>
        </GlassPanel>

        {/* Timeline */}
        <GlassPanel className="p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Timeline
            <span className="text-xs font-normal text-[var(--text-muted)]">{incident.updates.length} entries</span>
          </h3>
          <ul className="space-y-3">
            {[...incident.updates].reverse().map((u, idx) => (
              <li key={`${u.at}-${idx}`} className="flex gap-3 border-l-2 border-white/10 pl-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={STATUS_BADGE[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                    <span className="text-[var(--text-muted)]">{fmtAbs(u.at)}</span>
                    {u.author && <span className="text-[var(--text-muted)]">· {u.author}</span>}
                  </div>
                  <p className="text-sm text-[var(--text-primary)] mt-1 whitespace-pre-wrap">{u.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>

        {/* Append-update form */}
        {!isResolved && (
          <GlassPanel className="p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Add update</h3>
            <form onSubmit={handleAppend} className="space-y-3">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What's new? Investigation step, mitigation applied, hypothesis…"
                rows={3}
                maxLength={4000}
                required
              />
              <div className="flex items-center justify-between gap-3">
                <Select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as IncidentStatus | '')}
                  aria-label="Change status with this update"
                  options={[
                    { value: '', label: `Keep status as ${STATUS_LABEL[incident.status]}` },
                    { value: 'investigating', label: '→ Investigating' },
                    { value: 'identified', label: '→ Identified' },
                    { value: 'monitoring', label: '→ Monitoring' },
                    { value: 'resolved', label: '→ Resolved' },
                  ]}
                />
                <Button type="submit" variant="primary" disabled={appendUpdate.isPending}>
                  {appendUpdate.isPending ? 'Adding…' : 'Add update'}
                </Button>
              </div>
            </form>
          </GlassPanel>
        )}
      </div>

      <ConfirmDialog
        open={confirmResolve}
        onConfirm={handleResolve}
        onCancel={() => setConfirmResolve(false)}
        title="Resolve incident?"
        message="This will close the incident and stamp resolved_at. You can still view the timeline."
        confirmLabel="Resolve"
        cancelLabel="Cancel"
        loading={patch.isPending}
      />
    </PageContainer>
  )
}
