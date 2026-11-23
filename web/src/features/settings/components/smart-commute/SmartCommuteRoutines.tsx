import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, PanelTitle, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { SmartCommuteChange } from '@/api/hooks/useSmartCommute'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import type { SmartCommuteRoutine, SmartCommuteRoutineInput } from '@/types/smartCommute'
import { formatCommuteClock, useCommuteWeekdays } from '@/lib/smartCommuteDisplay'
import { SmartCommuteRoutineForm } from '@/features/smart-commute/components/SmartCommuteRoutineForm'
import { SmartCommuteTrafficReview } from './SmartCommuteTrafficReview'

interface Props {
  vehicleId: number
  timeZone: string
  enabled: boolean
  disabled: boolean
  scope: PersonalScope
  canSetUpTraffic: boolean
  routines: SmartCommuteRoutine[]
  onChange: (change: SmartCommuteChange) => Promise<boolean>
}

export function SmartCommuteRoutines({ vehicleId, timeZone, enabled, disabled, scope, canSetUpTraffic, routines, onChange }: Props) {
  const { t } = useTranslation()
  const { formatDate, formatDateTime } = useDateFormat()
  const weekdays = useCommuteWeekdays()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [trafficRoutine, setTrafficRoutine] = useState<number | null>(null)
  const editingRoutine = editing === 'new' || editing == null
    ? null
    : routines.find((routine) => routine.id === editing) ?? null
  const save = (routine: SmartCommuteRoutineInput) => editingRoutine
    ? onChange({ kind: 'confirm', id: editingRoutine.id, routine })
    : onChange({ kind: 'create', routine })

  return (
    <section className="space-y-4" aria-label={t('smartCommute.routines', 'Your routines')}>
      <PanelTitle>{t('smartCommute.routines', 'Your routines')}</PanelTitle>
      {routines.length === 0 && (
        <Text as="p" variant="bodySm">
          {t('smartCommute.noRoutines', 'No routine is saved or awaiting review. Enable local analysis or add one manually.')}
        </Text>
      )}
      {routines.map((routine) => (
        <article key={routine.id} className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <Text as="p" variant="body" weight="semibold">
            {routine.status === 'suggested'
              ? t('smartCommute.question', 'Is this your regular {{day}} drive?', {
                  day: weekdays[routine.weekday] ?? t('smartCommute.unknownDay', 'unknown day'),
                })
              : routine.name}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCommute.schedule', '{{day}} at {{time}} ({{zone}})', {
              day: weekdays[routine.weekday] ?? t('smartCommute.unknownDay', 'unknown day'),
              time: formatCommuteClock(routine.departure_s),
              zone: routine.time_zone,
            })}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCommute.endpoints', 'Origin: {{origin}}; destination: {{destination}}', {
              origin: `${routine.origin.latitude.toFixed(5)}, ${routine.origin.longitude.toFixed(5)}`,
              destination: `${routine.destination.latitude.toFixed(5)}, ${routine.destination.longitude.toFixed(5)}`,
            })}
          </Text>
          {routine.evidence && (
            <Text as="p" variant="bodySm">
              {t('smartCommute.evidence', '{{count}} matching days, departures between {{start}} and {{end}}. Last observed {{last}}.', {
                count: routine.evidence.matching_days,
                start: formatCommuteClock(routine.evidence.window_start_s),
                end: formatCommuteClock(routine.evidence.window_end_s),
                last: formatDate(routine.evidence.last_observed_at, { tz: timeZone }),
              })}
            </Text>
          )}
          {routine.snoozed_until && (
            <Text as="p" variant="bodySm">
              {t('smartCommute.snoozedUntil', 'Snoozed until {{until}}.', {
                until: formatDateTime(routine.snoozed_until, { tz: timeZone }),
              })}
            </Text>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || !enabled}
              onClick={() => setEditing(routine.id)}>
              {routine.status === 'suggested'
                ? t('smartCommute.useRoutine', 'Use routine')
                : t('smartCommute.edit', 'Edit')}
            </Button>
            {routine.status === 'suggested' ? (
              <>
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || !enabled}
                  onClick={() => setEditing(routine.id)}>
                  {t('smartCommute.edit', 'Edit')}
                </Button>
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || !enabled}
                  onClick={() => void onChange({ kind: 'decline', id: routine.id })}>
                  {t('smartCommute.notMine', 'Not mine')}
                </Button>
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || !enabled}
                  onClick={() => void onChange({
                    kind: 'snooze', id: routine.id,
                    durationS: routine.snoozed_until ? 0 : 24 * 60 * 60,
                  })}>
                  {routine.snoozed_until
                    ? t('smartCommute.showNow', 'Show suggestion now')
                    : t('smartCommute.snooze', 'Snooze for 24 hours')}
                </Button>
              </>
            ) : (
              <>
                {canSetUpTraffic && (
                  <Button type="button" variant="secondary" className="min-h-11" disabled={disabled}
                    onClick={() => setTrafficRoutine(routine.id)}>
                    {routine.traffic_consent
                      ? t('smartCommute.traffic.edit', 'Review traffic settings')
                      : t('smartCommute.traffic.setup', 'Set up traffic checks')}
                  </Button>
                )}
                {routine.traffic_consent?.can_skip_today && (
                  <Button type="button" variant="ghost" className="min-h-11" disabled={disabled}
                    onClick={() => void onChange({ kind: 'trafficSkip', id: routine.id })}>
                    {t('smartCommute.traffic.skip', 'Skip today')}
                  </Button>
                )}
                {routine.traffic_consent && (
                  <Button type="button" variant="ghost" className="min-h-11" disabled={disabled}
                    onClick={() => {
                      setTrafficRoutine(null)
                      void onChange({ kind: 'trafficDisconnect', id: routine.id })
                    }}>
                    {t('smartCommute.traffic.disconnect', 'Disconnect HERE')}
                  </Button>
                )}
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled}
                  onClick={() => setDeleting(routine.id)}>
                  {t('smartCommute.deleteRoutine', 'Delete routine')}
                </Button>
              </>
            )}
          </div>
          {canSetUpTraffic && trafficRoutine === routine.id && (
            <SmartCommuteTrafficReview key={`${routine.id}:${routine.updated_at}`} scope={scope} displayZone={timeZone}
              routine={routine} disabled={disabled} onChange={onChange} onClose={() => setTrafficRoutine(null)} />
          )}
        </article>
      ))}
      {editing == null || (editing !== 'new' && !editingRoutine) ? (
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || !enabled}
          onClick={() => setEditing('new')}>
          {t('smartCommute.addManual', 'Add a routine manually')}
        </Button>
      ) : (
        <SmartCommuteRoutineForm key={String(editing)} vehicleId={vehicleId} timeZone={timeZone}
          routine={editingRoutine} disabled={disabled || !enabled} onSave={save} onCancel={() => setEditing(null)} />
      )}
      <ConfirmDialog open={deleting != null} variant="danger" confirmDisabled={disabled}
        title={t('smartCommute.deleteRoutineTitle', 'Delete this routine?')}
        message={t('smartCommute.deleteRoutineDescription', 'The saved routine will be removed. Your original drives are not deleted.')}
        confirmLabel={t('smartCommute.deleteRoutine', 'Delete routine')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting != null) void onChange({ kind: 'deleteRoutine', id: deleting }).then((saved) => {
            if (saved) setDeleting(null)
          })
        }} />
    </section>
  )
}
