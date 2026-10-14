/**
 * Immediate self-hosted maintenance controls with an operator-configured end.
 *
 * Backend integration:
 *   GET  /admin/maintenance      — current state (mode + message + until)
 *   POST /admin/maintenance      — set / clear maintenance mode
 *
 * POST changes mode immediately; until is an end instant, never a future start.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, X } from 'lucide-react'
import { GlassPanel, Button, ConfirmDialog, Input, Badge, PanelTitle, Text } from '@/components/ui'
import { OperationalWriteNotice, QueryError, Skeleton, StaleRefreshWarning, useToast } from '@/components/feedback'
import { useMaintenanceState, useUpdateMaintenance } from '@/api/hooks/useAdmin'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { useDataState } from '@/hooks/useDataState'
import { cn } from '@/lib/cn'

interface ScheduledMaintenanceCardProps {
  now: number
}

function interpolateCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.split(`{{${key}}}`).join(String(value)),
    template,
  )
}

export function ScheduledMaintenanceCard({ now }: ScheduledMaintenanceCardProps) {
  const { t } = useTranslation()
  const query = useMaintenanceState()
  const { data: state } = query
  const sourceState = useDataState(query)
  const mutation = useUpdateMaintenance()
  const operationalMode = useOperationalMode()
  const toast = useToast()
  const { formatDateTime } = useDateFormat()
  const [showControls, setShowControls] = useState(false)
  const [endLocal, setEndLocal] = useState('')
  const [message, setMessage] = useState('')
  const [endError, setEndError] = useState('')

  const isActive = state?.mode === 'maintenance'
  // Guard against a malformed `maintenance_until` (non-ISO string → NaN). A raw
  // NaN would slip past the `untilTs != null` render checks below and paint a
  // stray "Until —" line, so collapse any non-finite parse back to null.
  const untilTs = useMemo(() => {
    if (!state?.maintenance_until) return null
    const parsed = Date.parse(state.maintenance_until)
    return Number.isFinite(parsed) ? parsed : null
  }, [state])
  const minutesRemaining = useMemo(() => {
    if (!untilTs || !isActive) return null
    return Math.floor((untilTs - now) / 60_000)
  }, [untilTs, now, isActive])
  const discardDraft = () => {
    setShowControls(false)
    setEndLocal('')
    setMessage('')
    setEndError('')
  }
  useEffect(() => {
    if (!operationalMode.canWrite) discardDraft()
  }, [operationalMode.canWrite])
  const draftIsDirty = showControls
    && (endLocal !== '' || message !== '')
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    draftIsDirty,
    discardDraft,
    {
      message: t(
        'systemStatus.maintenance.unsaved',
        'You have unsaved maintenance-window details. Discard them?',
      ),
    },
  )

  const handleEnable = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setEndError('')
    const endMs = Date.parse(endLocal)
    if (!Number.isFinite(endMs) || endMs <= now) {
      setEndError(t('fleetOps.assignmentDialog.endInvalid', 'Enter a valid end time.'))
      return
    }
    try {
      await mutation.mutateAsync({
        mode: 'maintenance',
        message: message.trim() || interpolateCopy(
          t(
            'systemStatus.maintenance.until',
            'Until {{time}}',
          ),
          {
            time: formatDateTime(new Date(endMs)),
          },
        ),
        until: new Date(endMs).toISOString(),
      })
      discardDraft()
      toast.success(t('toast.admin.maintenance.success', 'Maintenance state updated'))
    } catch (err) {
      toast.error(err instanceof Error
        ? err.message
        : t('toast.admin.maintenance.error', 'Failed to update maintenance state'))
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

  return (
    <GlassPanel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CalendarClock className={cn('h-4 w-4', isActive ? 'text-[var(--semantic-info)]' : 'text-[var(--text-secondary)]')} aria-hidden />
          <PanelTitle>{t('serviceMode.admin.modes.maintenance', 'Maintenance')}</PanelTitle>
          {isActive && <Badge variant="info">{t('systemStatus.maintenance.active', 'Maintenance active')}</Badge>}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <StaleRefreshWarning state={sourceState} label={t('serviceMode.admin.modes.maintenance', 'Maintenance')} />
        {sourceState.fatalError && <QueryError error={sourceState.fatalError} onRetry={() => { void query.refetch(); }} />}
        {query.isLoading && !sourceState.hasData && <Skeleton height={44} />}
        <OperationalWriteNotice
          title={t(
            'systemStatus.maintenance.readOnly',
            'Maintenance controls are read-only',
          )}
        />
        {isActive && state?.maintenance_message && (
          <Text variant="bodySm">{state.maintenance_message}</Text>
        )}
        {isActive && untilTs != null && (
          <Text as="p" variant="caption">
            {minutesRemaining != null && minutesRemaining > 0
              ? interpolateCopy(
                t(
                  'systemStatus.maintenance.activeUntil',
                  'Active until {{time}} ({{minutes}} min remaining)',
                ),
                {
                  time: formatDateTime(new Date(untilTs)),
                  minutes: minutesRemaining,
                },
              )
              : interpolateCopy(
                t('systemStatus.maintenance.until', 'Until {{time}}'),
                { time: formatDateTime(new Date(untilTs)) },
              )}
          </Text>
        )}
        {!isActive && !showControls && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowControls(true)}
            disabled={!operationalMode.canWrite}
            title={operationalMode.writeBlockReason ?? undefined}
            className="gap-1.5"
            wrapLabel
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {t('alertPacks.enableImmediately', 'Enable immediately')}
          </Button>
        )}

        {!isActive && showControls && (
          <form onSubmit={handleEnable} className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <Input
              label={t('chargePlanner.endTime', 'End time')}
              type="datetime-local"
              value={endLocal}
              onChange={(e) => {
                setEndLocal(e.target.value)
                setEndError('')
              }}
              error={endError || undefined}
              disabled={!operationalMode.canWrite}
              required
            />
            <Input
              label={t('systemStatus.maintenance.message', 'Operator message')}
              hint={t('systemStatus.maintenance.messageHint', 'Optional context shown in the maintenance banner.')}
              placeholder={t('systemStatus.maintenance.messagePlaceholder', "What's happening (optional)")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              disabled={!operationalMode.canWrite}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" wrapLabel onClick={requestClose} disabled={mutation.isPending}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={mutation.isPending}
                disabled={!operationalMode.canWrite}
                title={operationalMode.writeBlockReason ?? undefined}
                wrapLabel
              >
                {mutation.isPending
                  ? t('settingsBackup.import.applying', 'Applying…')
                  : t('alertPacks.enableImmediately', 'Enable immediately')}
              </Button>
            </div>
          </form>
        )}

        {isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            loading={mutation.isPending}
            disabled={!operationalMode.canWrite}
            title={operationalMode.writeBlockReason ?? undefined}
            className="gap-1.5"
            wrapLabel
          >
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
