import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useDrives } from '@/api/hooks/useDriving'
import { useSmartCommuteTrafficPreview, type SmartCommuteChange } from '@/api/hooks/useSmartCommute'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, Input, Select, Text, Toggle } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatCommuteClock, parseCommuteClock } from '@/lib/smartCommuteDisplay'
import type { SmartCommuteRoutine } from '@/types/smartCommute'

interface Props {
  scope: PersonalScope
  routine: SmartCommuteRoutine
  displayZone: string
  disabled: boolean
  onChange: (change: SmartCommuteChange) => Promise<boolean>
  onClose: () => void
}

const daysOfTraceHistory = 56

export function SmartCommuteTrafficReview({ scope, routine, displayZone, disabled, onChange, onClose }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const [window] = useState(() => {
    const now = Date.now()
    return { start: new Date(now - daysOfTraceHistory * 86_400_000).toISOString(), end: new Date(now).toISOString(), limit: 100 }
  })
  const drives = useDrives(String(routine.vehicle_id), window)
  const history = useDataState(drives)
  const preview = useSmartCommuteTrafficPreview(scope, routine.vehicle_id, routine.id)
  const [driveId, setDriveId] = useState('')
  const [lead, setLead] = useState(String((routine.traffic_consent?.lead_s ?? 900) / 60))
  const [minimum, setMinimum] = useState(String((routine.traffic_consent?.min_savings_s ?? 480) / 60))
  const [deadline, setDeadline] = useState(() => {
    const saved = routine.traffic_consent?.arrival_deadline_s
    return saved == null ? '' : formatCommuteClock(saved)
  })
  const [allow, setAllow] = useState(false)
  const [compareEnergy, setCompareEnergy] = useState(routine.traffic_consent?.compare_route_energy ?? false)
  const options = (history.data ?? []).filter((row) => row.vehicleId === routine.vehicle_id && row.endTs)
    .map((row) => ({
      value: String(row.id),
      label: t('smartCommute.traffic.driveOption', '{{time}} (drive {{id}})', {
        time: formatDateTime(row.startTs, { tz: displayZone }), id: row.id,
      }),
    }))
  const reviewed = preview.data?.data
  const leadMinutes = Number(lead)
  const minimumMinutes = Number(minimum)
  const deadlineS = parseCommuteClock(deadline)
  const nextArrivalS = deadlineS == null ? null : (deadlineS - routine.departure_s + 86_400) % 86_400
  const validDeadline = deadline === '' || (nextArrivalS != null && nextArrivalS > 0 && nextArrivalS <= 21_600)
  const validTiming = Number.isInteger(leadMinutes) && leadMinutes >= 5 && leadMinutes <= 60 &&
    Number.isInteger(minimumMinutes) && minimumMinutes >= 1 && minimumMinutes <= 60 && validDeadline
  const trace = reviewed?.trace ?? []

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border-subtle)] p-4">
      <Text as="p" variant="bodySm">
        {t('smartCommute.traffic.reviewHelp', 'Choose one recent completed drive that follows this routine. Previewing reads its location points locally and does not contact HERE.')}
      </Text>
      {history.fatalError ? (
        <QueryError error={history.fatalError} onRetry={history.retry ?? undefined} />
      ) : !history.hasData ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <StaleRefreshWarning state={history} label={t('smartCommute.traffic.recentDrive', 'Representative drive')} />
          {options.length === 0 ? (
            <Text as="p" variant="bodySm">{t('smartCommute.traffic.noDrives', 'There are no recent completed drives to review.')}</Text>
          ) : (
            <Select label={t('smartCommute.traffic.recentDrive', 'Representative drive')} options={options} value={driveId}
              placeholder={t('smartCommute.traffic.chooseDrive', 'Choose a completed drive')}
              disabled={disabled || preview.isPending} onChange={(event) => {
                preview.reset()
                setAllow(false)
                setDriveId(event.target.value)
              }} />
          )}
        </>
      )}
      <Button type="button" variant="secondary" disabled={disabled || history.status !== 'ok' || drives.isFetching ||
        preview.isPending || !options.some((option) => option.value === driveId)}
        onClick={() => { setAllow(false); preview.mutate(Number(driveId)) }}>
        {t('smartCommute.traffic.preview', 'Preview points locally')}
      </Button>
      {preview.isPending && <Skeleton lines={2} />}
      {preview.error && (
        <Text as="p" variant="bodySm" role="alert">
          {t('smartCommute.traffic.previewFailed', 'This drive could not be previewed. Choose a completed drive with recorded locations that matches the routine.')}
        </Text>
      )}
      {reviewed && trace.length > 0 && (
        <div className="space-y-4">
          <Text as="p" variant="bodySm">
            {t('smartCommute.traffic.disclosure', 'When a check is due, HERE receives these exact coordinates and the planned departure time. It does not get the routine name, VIN, or other drives.')}
          </Text>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-[var(--border-subtle)] p-2"
            aria-label={t('smartCommute.traffic.points', 'Coordinates that can be shared with HERE')}>
            {trace.map((point) => `${point.latitude}, ${point.longitude}`).join('\n')}
          </pre>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="number" label={t('smartCommute.traffic.lead', 'Check this many minutes before departure')}
              min={5} max={60} step={1} value={lead} disabled={disabled} onChange={(event) => setLead(event.target.value)} />
            <Input type="number" label={t('smartCommute.traffic.minimum', 'Minimum time saving in minutes')}
              min={1} max={60} step={1} value={minimum} disabled={disabled} onChange={(event) => setMinimum(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Input type="time" label={t('smartCommute.traffic.deadline.input', 'Arrival deadline (optional)')}
              value={deadline} disabled={disabled} aria-invalid={!validDeadline}
              onChange={(event) => setDeadline(event.target.value)} />
            <Text as="p" variant="bodySm">
              {t('smartCommute.traffic.deadline.help', 'Set a time within six hours after departure in {{zone}}, or leave it blank. This stays in TeslaSync and does not require calendar access.', { zone: routine.time_zone })}
            </Text>
            <Text as="p" variant="bodySm">
              {t('smartCommute.traffic.deadline.disclosure', 'If an earlier departure may help, TeslaSync also asks HERE for an estimate at that departure time. The deadline itself is not sent.')}
            </Text>
          </div>
          <Toggle label={t('smartCommute.traffic.allow', 'Allow sharing this trace with HERE for this routine')}
            checked={allow} disabled={disabled} onChange={setAllow} />
          <div className="space-y-2">
            <Toggle label={t('smartCommute.traffic.energy.allow', 'Compare routes using local driving energy history')}
              checked={compareEnergy} disabled={disabled} onChange={setCompareEnergy} />
            <Text as="p" variant="bodySm">
              {t('smartCommute.traffic.energy.consent', 'Off by default. TeslaSync checks comparable completed drives locally. It never sends their routes, temperatures, or energy use to HERE. Energy comparisons do not send push notifications.')}
            </Text>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={disabled || !allow || !reviewed || !validTiming || preview.isPending}
          onClick={() => {
            if (!allow || !reviewed || !validTiming) return
            void onChange({ kind: 'trafficConsent', id: routine.id, traffic: {
              drive_id: reviewed.drive_id, fingerprint: reviewed.fingerprint,
              lead_s: leadMinutes * 60, min_savings_s: minimumMinutes * 60, share_with_here: true,
              ...(deadlineS != null ? { arrival_deadline_s: deadlineS } : {}),
              ...(compareEnergy ? { compare_route_energy: true } : {}),
            } }).then((saved) => { if (saved) onClose() })
          }}>
          {t('smartCommute.traffic.enable', 'Enable traffic checks')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
      </div>
    </div>
  )
}
