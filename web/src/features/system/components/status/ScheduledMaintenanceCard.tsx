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

import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, AlertTriangle, X } from 'lucide-react'
import { GlassPanel, Button, ConfirmDialog, Input, Badge, PanelTitle, Text } from '@/components/ui'
import { useToast } from '@/components/feedback'
import { useMaintenanceState, useUpdateMaintenance } from '@/api/hooks/useAdmin'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard'
import { cn } from '@/lib/cn'

interface ScheduledMaintenanceCardProps {
  now: number
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function interpolateCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.split(`{{${key}}}`).join(String(value)),
    template,
  )
}

export function ScheduledMaintenanceCard({ now }: ScheduledMaintenanceCardProps) {
  const { t } = useTranslation()
  const { data: state } = useMaintenanceState()
  const mutation = useUpdateMaintenance()
  const toast = useToast()
  const { formatDateTime } = useDateFormat()
  const [showSchedule, setShowSchedule] = useState(false)
  const [whenLocal, setWhenLocal] = useState('')
  const [duration, setDuration] = useState('60')
  const [message, setMessage] = useState('')
  const [startError, setStartError] = useState('')
  const [durationError, setDurationError] = useState('')

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
  const discardSchedule = () => {
    setShowSchedule(false)
    setWhenLocal('')
    setDuration('60')
    setMessage('')
    setStartError('')
    setDurationError('')
  }
  const scheduleIsDirty = showSchedule
    && (whenLocal !== '' || duration !== '60' || message !== '')
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    scheduleIsDirty,
    discardSchedule,
    {
      message: t(
        'systemStatus.maintenance.unsaved',
        'You have unsaved maintenance-window details. Discard them?',
      ),
    },
  )

  const handleSchedule = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setStartError('')
    setDurationError('')
    if (!whenLocal) {
      const error = t('systemStatus.maintenance.startRequired', 'Pick a start time.')
      setStartError(error)
      return
    }
    const startMs = Date.parse(whenLocal)
    if (!Number.isFinite(startMs)) {
      const error = t('systemStatus.maintenance.startInvalid', 'Invalid start time.')
      setStartError(error)
      return
    }
    const parsedDuration = Number(duration)
    if (!duration.trim() || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      const error = t(
        'systemStatus.maintenance.durationRequired',
        'Enter a valid duration in minutes.',
      )
      setDurationError(error)
      return
    }
    if (parsedDuration > 1440) {
      const error = t(
        'systemStatus.maintenance.durationInvalid',
        'Duration cannot exceed 1,440 minutes.',
      )
      setDurationError(error)
      return
    }
    const durMin = Math.max(5, parsedDuration || 60)
    const endMs = startMs + durMin * 60_000
    try {
      await mutation.mutateAsync({
        mode: 'maintenance',
        message: message.trim() || interpolateCopy(
          t(
            'systemStatus.maintenance.defaultMessage',
            'Scheduled maintenance · ends {{time}}',
          ),
          {
          time: formatDateTime(new Date(endMs)),
          },
        ),
        until: new Date(endMs).toISOString(),
      })
      discardSchedule()
      toast.success(t('systemStatus.maintenance.scheduled', 'Maintenance window scheduled.'))
    } catch (err) {
      toast.error(err instanceof Error
        ? err.message
        : t('systemStatus.maintenance.scheduleFailed', 'Failed to schedule'))
    }
  }

  const handleClear = async () => {
    try {
      await mutation.mutateAsync({ mode: 'ok', message: '', until: null })
      toast.success(t('systemStatus.maintenance.cleared', 'Maintenance cleared.'))
    } catch (err) {
      toast.error(err instanceof Error
        ? err.message
        : t('systemStatus.maintenance.clearFailed', 'Failed to clear maintenance'))
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
          <PanelTitle>{t('systemStatus.maintenance.title', 'Scheduled maintenance')}</PanelTitle>
          {isActive && <Badge variant="info">{t('systemStatus.maintenance.active', 'Maintenance active')}</Badge>}
          {within24h && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-200">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {t('systemStatus.maintenance.within24h', 'Within 24h')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm">
        {isActive && state?.maintenance_message && (
          <Text variant="bodySm">{state.maintenance_message}</Text>
        )}
        {isActive && untilTs != null && (
          <p className="text-xs text-[var(--text-muted)]">
            {minutesToStart != null && minutesToStart > 0
              ? interpolateCopy(
                t(
                  'systemStatus.maintenance.activeUntil',
                  'Active until {{time}} ({{minutes}} min remaining)',
                ),
                {
                  time: formatDateTime(new Date(untilTs)),
                  minutes: minutesToStart,
                },
              )
              : interpolateCopy(
                t('systemStatus.maintenance.until', 'Until {{time}}'),
                { time: formatDateTime(new Date(untilTs)) },
              )}
          </p>
        )}
        {!isActive && !showSchedule && (
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              'systemStatus.maintenance.description',
              'Schedule a window for upgrades or hardware moves. The status banner will switch to blue “Maintenance” instead of red “Down”.',
            )}
          </p>
        )}

        {!isActive && !showSchedule && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowSchedule(true)} className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {t('systemStatus.maintenance.scheduleAction', 'Schedule a window')}
          </Button>
        )}

        {!isActive && showSchedule && (
          <form onSubmit={handleSchedule} className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('systemStatus.maintenance.start', 'Start (local)')}
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => {
                  setWhenLocal(e.target.value)
                  setStartError('')
                }}
                error={startError || undefined}
                required
              />
              <Input
                label={t('systemStatus.maintenance.duration', 'Duration (minutes)')}
                type="number"
                min={5}
                max={1440}
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value)
                  setDurationError('')
                }}
                error={durationError || undefined}
                required
              />
            </div>
            <Input
              label={t('systemStatus.maintenance.message', 'Operator message')}
              hint={t('systemStatus.maintenance.messageHint', 'Optional context shown in the maintenance banner.')}
              placeholder={t('systemStatus.maintenance.messagePlaceholder', "What's happening (optional)")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={mutation.isPending}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={mutation.isPending}>
                {mutation.isPending
                  ? t('systemStatus.maintenance.scheduling', 'Scheduling…')
                  : t('systemStatus.maintenance.schedule', 'Schedule')}
              </Button>
            </div>
          </form>
        )}

        {isActive && (
          <Button type="button" variant="ghost" size="sm" onClick={handleClear} loading={mutation.isPending} className="gap-1.5 text-amber-200">
            <X className="h-3.5 w-3.5" aria-hidden />
            {mutation.isPending
              ? t('systemStatus.maintenance.clearing', 'Clearing…')
              : t('systemStatus.maintenance.clear', 'Clear maintenance')}
          </Button>
        )}
      </div>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </GlassPanel>
  )
}
