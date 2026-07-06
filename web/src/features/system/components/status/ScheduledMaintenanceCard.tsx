/**
 * ScheduledMaintenanceCard for self-hosted maintenance scheduling.
 *
 * Surfaces upcoming + active maintenance windows on /system-status and
 * lets the operator schedule a new one inline.
 *
 * Backend integration:
 *   GET  /admin/maintenance      — current state (mode + message + until)
 *   POST /admin/maintenance      — set / clear maintenance mode
 *
 * Behaviour:
 *   • If maintenance is active right now → blue "Maintenance" badge,
 *     "Active until …" + Clear CTA.
 *   • If maintenance is scheduled in the future → "Scheduled in N hours"
 *     with a Cancel CTA. (We intentionally use the same backend slot;
 *     the future timestamp is the "until" value, and the system flips
 *     to "maintenance" at that moment.)
 *   • Otherwise → quick scheduler form (operator-supplied window).
 *
 * 24h pre-banner: when maintenance is scheduled within the next 24
 * hours, this card itself bumps to amber to give the operator a clear
 * heads-up. The full app-wide MaintenanceBanner already handles the
 * "active now" case; we don't double up.
 */

import { useId, useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, AlertTriangle, X } from 'lucide-react'
import { GlassPanel, Button, Input, Badge } from '@/components/ui'
import { useToast } from '@/components/feedback/Toast'
import { useMaintenanceState, useUpdateMaintenance } from '@/api/hooks/useAdmin'
import { useDateFormat } from '@/hooks/useDateFormat'
import { cn } from '@/lib/cn'

interface ScheduledMaintenanceCardProps {
  now: number
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function ScheduledMaintenanceCard({ now }: ScheduledMaintenanceCardProps) {
  const { data: state } = useMaintenanceState()
  const mutation = useUpdateMaintenance()
  const toast = useToast()
  const { formatDateTime } = useDateFormat()
  const startId = useId()
  const durationId = useId()
  const [showSchedule, setShowSchedule] = useState(false)
  const [whenLocal, setWhenLocal] = useState('')
  const [duration, setDuration] = useState('60')
  const [message, setMessage] = useState('')

  const isActive = state?.mode === 'maintenance'
  // Guard against a malformed `maintenance_until` (non-ISO string → NaN). A raw
  // NaN would slip past the `untilTs != null` render checks below and paint a
  // stray "Until —" line, so collapse any non-finite parse back to null.
  const untilTs = useMemo(() => {
    if (!state?.maintenance_until) return null
    const parsed = Date.parse(state.maintenance_until)
    return Number.isFinite(parsed) ? parsed : null
  }, [state])
  const minutesToStart = useMemo(() => {
    if (!untilTs || !isActive) return null
    return Math.floor((untilTs - now) / 60_000)
  }, [untilTs, now, isActive])

  const handleSchedule = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!whenLocal) {
      toast.error('Pick a start time.')
      return
    }
    const startMs = Date.parse(whenLocal)
    if (!Number.isFinite(startMs)) {
      toast.error('Invalid start time.')
      return
    }
    const durMin = Math.max(5, Number(duration) || 60)
    const endMs = startMs + durMin * 60_000
    try {
      await mutation.mutateAsync({
        mode: 'maintenance',
        message: message.trim() || `Scheduled maintenance · ends ${formatDateTime(new Date(endMs))}`,
        until: new Date(endMs).toISOString(),
      })
      setShowSchedule(false)
      setWhenLocal('')
      setMessage('')
      toast.success('Maintenance window scheduled.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule')
    }
  }

  const handleClear = async () => {
    try {
      await mutation.mutateAsync({ mode: 'ok', message: '', until: null })
      toast.success('Maintenance cleared.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear maintenance')
    }
  }

  const within24h = isActive && untilTs != null && untilTs - now <= ONE_DAY_MS && untilTs - now > 0
  const ringClass = within24h
    ? 'ring-amber-400/40 bg-amber-500/[0.04]'
    : isActive
      ? 'ring-blue-400/30 bg-blue-500/[0.04]'
      : 'ring-white/5'

  return (
    <GlassPanel className={cn('p-4 ring-1', ringClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className={cn('h-4 w-4', isActive ? 'text-blue-300' : 'text-[var(--text-secondary)]')} aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Scheduled maintenance</h3>
          {isActive && <Badge variant="info">Maintenance active</Badge>}
          {within24h && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-200">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Within 24h
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm">
        {isActive && state?.maintenance_message && (
          <p className="text-[var(--text-secondary)]">{state.maintenance_message}</p>
        )}
        {isActive && untilTs != null && (
          <p className="text-xs text-[var(--text-muted)]">
            {minutesToStart != null && minutesToStart > 0
              ? `Active until ${formatDateTime(new Date(untilTs))} (${minutesToStart} min remaining)`
              : `Until ${formatDateTime(new Date(untilTs))}`}
          </p>
        )}
        {!isActive && !showSchedule && (
          <p className="text-xs text-[var(--text-muted)]">
            Schedule a window for upgrades or hardware moves. The status banner will switch to blue
            “Maintenance” instead of red “Down”.
          </p>
        )}

        {!isActive && !showSchedule && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowSchedule(true)} className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Schedule a window
          </Button>
        )}

        {!isActive && showSchedule && (
          <form onSubmit={handleSchedule} className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={startId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start (local)</label>
                <Input id={startId} type="datetime-local" value={whenLocal} onChange={(e) => setWhenLocal(e.target.value)} required />
              </div>
              <div>
                <label htmlFor={durationId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Duration (minutes)</label>
                <Input id={durationId} type="number" min={5} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
            </div>
            <Input
              placeholder="What's happening (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowSchedule(false)} disabled={mutation.isPending}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? 'Scheduling…' : 'Schedule'}
              </Button>
            </div>
          </form>
        )}

        {isActive && (
          <Button type="button" variant="ghost" size="sm" onClick={handleClear} disabled={mutation.isPending} className="gap-1.5 text-amber-200">
            <X className="h-3.5 w-3.5" aria-hidden />
            {mutation.isPending ? 'Clearing…' : 'Clear maintenance'}
          </Button>
        )}
      </div>
    </GlassPanel>
  )
}
