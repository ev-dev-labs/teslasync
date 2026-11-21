import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, ErrorText, Input } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useSettings } from '@/hooks/useSettings'
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert'
import { formatForUnit, parseForUnit, unitSymbol } from '@/lib/unitInput'
import type { TripMaintenanceSetup } from '@/types/smartTripMaintenance'

interface Props {
  version: number
  setup: TripMaintenanceSetup | null
  disabled: boolean
  onSave: (setup: TripMaintenanceSetup) => void
  onCancel: () => void
}

const distances = ['service_odometer_m', 'interval_m', 'trip_distance_low_m', 'trip_distance_high_m'] as const

export function TripMaintenanceForm({ version, setup, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const { tz } = useDateFormat('user')
  const unit = unitSymbol('distance', settings)
  const labels = {
    service_odometer_m: t('smartCharging.tripMaintenance.odometer', 'Odometer at completed service ({{unit}})', { unit }),
    interval_m: t('smartCharging.tripMaintenance.interval', 'Documented service interval ({{unit}})', { unit }),
    trip_distance_low_m: t('smartCharging.tripMaintenance.lower', 'Lower total trip distance ({{unit}})', { unit }),
    trip_distance_high_m: t('smartCharging.tripMaintenance.upper', 'Upper total trip distance ({{unit}})', { unit }),
  }
  const [label, setLabel] = useState(setup?.service_label ?? '')
  const [completedAt, setCompletedAt] = useState(() => setup?.service_completed_at
    ? toZonedDatetimeStr(new Date(setup.service_completed_at), tz) : '')
  const [values, setValues] = useState(() => ({
    service_odometer_m: formatForUnit(setup?.service_odometer_m, 'distance', settings),
    interval_m: formatForUnit(setup?.interval_m, 'distance', settings),
    trip_distance_low_m: formatForUnit(setup?.trip_distance_low_m, 'distance', settings),
    trip_distance_high_m: formatForUnit(setup?.trip_distance_high_m, 'distance', settings),
  }))
  const [consent, setConsent] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (disabled || !consent) return
    const when = zonedWallTimeToUtc(completedAt, tz)
    const [odometer, interval, low, high] = distances.map((field) => parseForUnit(values[field], 'distance', settings))
    const service = label.trim()
    if (!service || new TextEncoder().encode(service).length > 120 || !when || when.getTime() > Date.now() ||
      odometer == null || odometer < 0 || odometer > 10_000_000_000 || interval == null || interval < 1 || interval > 1_000_000_000 ||
      low == null || low < 1 || high == null || high < low || high > 20_000_000) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onSave({
      plan_version: version, service_label: service, service_completed_at: when.toISOString(),
      service_odometer_m: odometer, interval_m: interval, trip_distance_low_m: low, trip_distance_high_m: high,
    })
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label={t('smartCharging.tripMaintenance.service', 'Recorded maintenance item')} required maxLength={120}
          value={label} onChange={(event) => setLabel(event.target.value)} disabled={disabled} />
        <Input type="datetime-local" label={t('smartCharging.tripMaintenance.completed', 'Completed service ({{zone}})', { zone: tz })}
          required value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} disabled={disabled} />
        {distances.map((field) => <Input key={field} label={labels[field]} inputMode="decimal" required
          value={values[field]} onChange={(event) => setValues({ ...values, [field]: event.target.value })} disabled={disabled} />)}
      </div>
      <Checkbox label={t('smartCharging.tripMaintenance.consent', 'Compare this trip with the recorded service interval and this vehicle’s recent odometer readings. Nothing is sent outside TeslaSync.')}
        checked={consent} onChange={setConsent} disabled={disabled} />
      {invalid && <ErrorText role="alert">
        {t('smartCharging.tripMaintenance.invalid', 'Enter a completed service, a valid odometer and interval, and positive trip distances in increasing order.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled || !consent}>
          {t('smartCharging.tripMaintenance.save', 'Save private maintenance check')}
        </Button>
        <Button type="button" className="min-h-11" variant="secondary" onClick={onCancel} disabled={disabled}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
