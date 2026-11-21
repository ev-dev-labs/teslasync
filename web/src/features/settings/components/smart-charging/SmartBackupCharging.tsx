import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { usePersonalDeliveryDevices } from '@/api/hooks/usePersonalDelivery'
import { useSmartBackupCharging, useSmartBackupChargingChange } from '@/api/hooks/useSmartBackupCharging'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, PanelTitle, Select, Text, Toggle } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry'
import { useUnits } from '@/hooks/useUnits'

interface Props {
  scope: PersonalScope
  vehicleId: number
  places: readonly { id: number; name: string; updated_at: string }[]
  disabled: boolean
  placesUnavailable: boolean
}

export function SmartBackupCharging({ scope, vehicleId, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const { formatPower } = useUnits()
  const { hash, search } = useLocation()
  const section = useRef<HTMLElement>(null)
  const [place, setPlace] = useState('')
  const [device, setDevice] = useState('')
  const [circuit, setCircuit] = useState('')
  const [outage, setOutage] = useState('')
  const query = useSmartBackupCharging(scope, vehicleId)
  const state = useDataState(query)
  const settings = state.data
  const watch = settings?.watch
  const requested = new URLSearchParams(search).get('backup_watch_id')
  const wrongWatch = requested != null && requested !== String(watch?.id)
  const canStart = settings?.available === true && settings.connected && !watch && !wrongWatch
  const devices = usePersonalDeliveryDevices(scope, canStart)
  const deviceState = useDataState(devices)
  const change = useSmartBackupChargingChange(scope, vehicleId)
  const denied = isApiError(query.error) &&
    (query.error.status === 401 || query.error.status === 403 || query.error.code === 'IDENTITY_CHANGED')
  const allowed = !disabled && !denied && state.status === 'ok' && !query.isFetching && !change.isPending
  const eligibleDevices = (devices.data?.devices ?? []).filter(({ verified, charging_enabled }) => verified && charging_enabled)
  const selectedDevice = eligibleDevices.find(({ id }) => String(id) === device)
  const selectedPlace = places.find(({ id }) => String(id) === place)
  const revision = settings?.connection_revision
  const confirmationKey = revision && selectedPlace && selectedDevice
    ? `${revision}:${vehicleId}:${selectedPlace.id}:${selectedPlace.updated_at}:${selectedDevice.id}:${selectedDevice.updated_at}` : ''
  const formEnabled = allowed && !placesUnavailable && deviceState.status === 'ok' && !devices.isFetching
  const confirmed = confirmationKey !== '' && confirmationKey === circuit && confirmationKey === outage
  const evidence = !wrongWatch && !denied && state.status === 'ok' ? settings?.decision?.evidence : null
  const currentEvidence = usePrivateReviewExpiry(evidence?.expires_at, query.refetch)
  const active = settings?.active === true
  const review = evidence && currentEvidence && active ? evidence : null
  const title = t('smartCharging.backup.title', 'Charging on household backup')
  const settingsPath = `/settings/smart-charging?vehicle_id=${vehicleId}#backup-charging`

  useEffect(() => {
    if (hash === '#backup-charging') section.current?.scrollIntoView?.({ block: 'start' })
  }, [hash, watch?.id])

  return (
    <section id="backup-charging" ref={section} className="scroll-mt-4 space-y-3" aria-label={title}>
      <PanelTitle>{title}</PanelTitle>
      <Text as="p" variant="bodySm">{t('smartCharging.backup.privacy', 'Off by default. After you confirm a current utility outage, TeslaSync checks read-only Tesla Energy meters for one hour and can notify one verified browser. The vehicle location stays here. No vehicle or home settings are changed.')}</Text>
      {scope.mode === 'open' ? (
        <Text as="p" variant="bodySm">{t('smartCharging.backup.signIn', 'Sign in to use a private backup charging watch.')}</Text>
      ) : denied || state.fatalError ? (
        <QueryError error={denied ? query.error : state.fatalError} onRetry={() => void query.refetch()} />
      ) : !settings ? <Skeleton lines={2} /> : (
        <>
          <StaleRefreshWarning state={state} label={title} />
          {change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
          {wrongWatch ? (
            <Text as="p" variant="bodySm">{t('smartCharging.backup.expiredLink', 'This private watch is no longer available.')}
              {' '}<Link className="text-theme-accent underline underline-offset-2" to={settingsPath}>{t('smartCharging.backup.openSettings', 'Open watch settings')}</Link>
            </Text>
          ) : watch ? (
            <>
              <Text as="p" variant="bodySm">{active
                ? t('smartCharging.backup.active', 'Watching until {{until}} unless grid service returns or you stop the watch.', { until: formatDateTime(watch.watch_until) })
                : t('smartCharging.backup.ended', 'This watch ended. Remove it before starting a new watch.')}</Text>
              {review ? (
                <div className="space-y-2" role="status">
                  <Text as="p" weight="semibold">{t('smartCharging.backup.reviewTitle', 'Vehicle charging is drawing from household backup')}</Text>
                  <Text as="p" variant="bodySm">{t('smartCharging.backup.evidence', 'Two consistent readings after your outage confirmation show {{vehicle}} of vehicle charging and at least {{minimum}} coming from the home battery. This is a conservative estimate from the site meters, not a backup runtime forecast.', {
                    vehicle: formatPower(review.vehicle_power_w), minimum: formatPower(review.minimum_battery_to_load_w),
                  })}</Text>
                  <Text as="p" variant="bodySm">{t('smartCharging.backup.timing', 'Observed {{observed}}; advice expires {{expires}}.', {
                    observed: formatDateTime(review.observed_at), expires: formatDateTime(review.expires_at),
                  })}</Text>
                  <Link className="text-theme-accent underline underline-offset-2" to={`/vehicles/${vehicleId}#vehicle-systems`}>
                    {t('smartCharging.backup.review', 'Review charging telemetry')}
                  </Link>
                </div>
              ) : active && <Text as="p" variant="bodySm">{t('smartCharging.backup.waiting', 'No current evidence of a material draw from backup.')}</Text>}
              <Button variant="ghost" disabled={!allowed} onClick={() => change.mutate({ kind: 'stop', watchId: watch.id })}>
                {t('smartCharging.backup.stop', 'Stop and remove this watch')}
              </Button>
            </>
          ) : !settings.available ? (
            <Text as="p" variant="bodySm">{t('smartCharging.backup.unavailable', 'Setup requires read-only Tesla Energy, shared live signals, and personal browser notifications.')}</Text>
          ) : !settings.connected ? (
            <Text as="p" variant="bodySm">{t('smartCharging.backup.connect', 'Connect the backed-up Tesla Energy site under Solar charging opportunities first. Solar checks may remain off.')}</Text>
          ) : deviceState.fatalError ? (
            <QueryError error={deviceState.fatalError} onRetry={() => void devices.refetch()} />
          ) : !deviceState.hasData ? <Skeleton lines={2} /> : (
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault()
              if (!formEnabled || !revision || !selectedPlace || !selectedDevice || !confirmed) return
              change.mutate({
                kind: 'start', connectionRevision: revision, placeId: selectedPlace.id, placeUpdatedAt: selectedPlace.updated_at,
                deviceId: selectedDevice.id, deviceUpdatedAt: selectedDevice.updated_at,
              }, {
                onSuccess: () => { setCircuit(''); setOutage('') },
              })
            }}>
              <StaleRefreshWarning state={deviceState} label={t('smartCharging.backup.device', 'Verified browser')} />
              <Select label={t('smartCharging.backup.place', 'Backed-up charging place')}
                placeholder={t('smartCharging.solar.selectPlace', 'Choose a reviewed charging place')}
                value={place} disabled={!formEnabled} onChange={(event) => setPlace(event.target.value)}
                options={places.map(({ id, name }) => ({ value: String(id), label: name }))} />
              <Select label={t('smartCharging.backup.device', 'Verified browser')}
                placeholder={t('smartCharging.backup.chooseDevice', 'Choose one verified browser')}
                value={device} disabled={!formEnabled} onChange={(event) => setDevice(event.target.value)}
                options={eligibleDevices.map(({ id }) => ({ value: String(id), label: t('smartCharging.backup.deviceNumber', 'Browser {{id}}', { id }) }))} />
              {eligibleDevices.length === 0 && <Text as="p" variant="bodySm">{t('smartCharging.backup.noDevice', 'Verify a browser and enable charging notifications in Personal delivery before starting.')}</Text>}
              <Toggle label={t('smartCharging.backup.confirmCircuit', 'I verified this charger is on the connected site’s backed-up circuit')}
                checked={confirmationKey !== '' && circuit === confirmationKey}
                onChange={(checked) => setCircuit(checked ? confirmationKey : '')} disabled={!formEnabled || !confirmationKey} />
              <Toggle label={t('smartCharging.backup.confirmOutage', 'I confirmed a current utility outage, not intentional off-grid mode')}
                checked={confirmationKey !== '' && outage === confirmationKey}
                onChange={(checked) => setOutage(checked ? confirmationKey : '')} disabled={!formEnabled || !confirmationKey} />
              <div><Button type="submit" variant="secondary" disabled={!formEnabled || !confirmed}>
                {t('smartCharging.backup.start', 'Watch this outage for one hour')}
              </Button></div>
            </form>
          )}
        </>
      )}
    </section>
  )
}
