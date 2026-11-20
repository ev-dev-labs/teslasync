import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useSmartSolar, useSmartSolarChange } from '@/api/hooks/useSmartSolar'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, Input, PanelTitle, Select, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useSolarChargingDisplay } from '@/lib/solarChargingDisplay'

interface Props {
  scope: PersonalScope
  vehicleId: number
  places: readonly { id: number; name: string; updated_at: string }[]
  disabled: boolean
  placesUnavailable: boolean
}

export function SmartChargingSolar({ scope, vehicleId, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { search, hash } = useLocation()
  const section = useRef<HTMLElement>(null)
  const [site, setSite] = useState('')
  const [place, setPlace] = useState('')
  const query = useSmartSolar(scope, vehicleId)
  const state = useDataState(query)
  const change = useSmartSolarChange(scope, vehicleId)
  const settings = state.data
  const accessDenied = isApiError(query.error) &&
    (query.error.status === 401 || query.error.status === 403 || query.error.code === 'IDENTITY_CHANGED')
  const allowed = !disabled && !accessDenied && state.status === 'ok' && !query.isFetching && !change.isPending
  const selectedPlace = places.find(({ id }) => String(id) === (place || String(settings?.plan?.place_id ?? '')))
  const validSite = /^[1-9]\d{0,18}$/.test(site.trim())
  const title = t('smartCharging.solar.title', 'Solar charging opportunities')
  const decision = state.status === 'ok' && !accessDenied ? settings?.decision : null
  const offer = useSolarChargingDisplay(decision && Date.parse(decision.expires_at) > Date.now() ? decision : null)

  useEffect(() => {
    if (hash === '#solar-charging') section.current?.scrollIntoView?.({ block: 'start' })
  }, [hash])

  return (
    <section id="solar-charging" ref={section} className="scroll-mt-4 space-y-3" aria-label={title}>
      <PanelTitle>{title}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.solar.privacy', 'Off by default. Allow read-only Tesla Energy access for one site, then choose a home charger for this vehicle. No push, vehicle wake, charging change, or change to your backup reserve.')}
      </Text>
      {accessDenied || state.fatalError ? (
        <QueryError error={accessDenied ? query.error : state.fatalError} onRetry={() => void query.refetch()} />
      ) : !settings ? <Skeleton lines={2} /> : (
        <>
          <StaleRefreshWarning state={state} label={title} />
          {change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
          {new URLSearchParams(search).get('solar') === 'failed' && !settings.energy_site_id && (
            <ErrorText role="alert">{t('smartCharging.solar.linkFailed', 'Tesla Energy was not connected. Check the site ID and Tesla permissions, then try again.')}</ErrorText>
          )}
          {!settings.available && (
            <Text as="p" variant="bodySm">{t('smartCharging.solar.unavailable', 'Setup requires Tesla Fleet API credentials, an HTTPS callback registered with Tesla, encryption, and shared live signals.')}</Text>
          )}
          {settings.energy_site_id == null ? settings.available && (
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault()
              if (!allowed || !validSite) return
              change.mutate({ kind: 'connect', siteId: site.trim() }, {
                onSuccess: (link) => { if (link) window.location.assign(link) },
              })
            }}>
              <Input label={t('smartCharging.solar.siteId', 'Tesla Energy site ID')} inputMode="numeric"
                value={site} onChange={(event) => setSite(event.target.value)} disabled={!allowed} />
              <Text as="p" variant="bodySm">{t('smartCharging.solar.siteHelp', 'Use the energy_site_id of your Solar and Powerwall installation from the Tesla Fleet API Products endpoint. The site ID is sent to Tesla to verify access and read its status.')}</Text>
              <Button type="submit" variant="secondary" disabled={!allowed || !validSite}>
                {t('smartCharging.solar.connect', 'Connect read-only Tesla Energy')}
              </Button>
            </form>
          ) : (
            <>
              <Text as="p" variant="bodySm">{t('smartCharging.solar.connected', 'Tesla Energy site {{site}} is connected.', { site: settings.energy_site_id })}</Text>
              <form className="space-y-3" onSubmit={(event) => {
                event.preventDefault()
                if (!allowed || !settings.available || placesUnavailable || !selectedPlace) return
                change.mutate({ kind: 'enable', placeId: selectedPlace.id, updatedAt: selectedPlace.updated_at })
              }}>
                <Select label={t('smartCharging.solar.place', 'Home charger')} value={selectedPlace ? String(selectedPlace.id) : ''}
                  placeholder={t('smartCharging.solar.selectPlace', 'Choose a reviewed charging place')}
                  disabled={!allowed || !settings.available || placesUnavailable}
                  options={places.map(({ id, name }) => ({ value: String(id), label: name }))}
                  onChange={(event) => setPlace(event.target.value)} />
                <Button type="submit" variant="secondary" disabled={!allowed || !settings.available || placesUnavailable || !selectedPlace ||
                  (settings.plan?.place_id === selectedPlace.id &&
                    Date.parse(settings.plan.place_updated_at) === Date.parse(selectedPlace.updated_at))}>
                  {settings.plan ? t('smartCharging.solar.changePlace', 'Use this home charger') : t('smartCharging.solar.enable', 'Enable solar checks for this vehicle')}
                </Button>
              </form>
              {offer ? (
                <div className="space-y-2" role="status">
                  <Text as="p" weight="semibold">{offer.title}</Text>
                  <Text as="p" variant="bodySm">{offer.summary}</Text>
                  <Text as="p" variant="bodySm">{offer.timing}</Text>
                  <Link className="text-theme-accent underline underline-offset-2" to={`/charging?vehicle_id=${vehicleId}`}>
                    {t('smartCharging.solar.review', 'Review charging activity')}
                  </Link>
                </div>
              ) : (
                <Text as="p" variant="bodySm">{settings.plan
                  ? t('smartCharging.solar.noDecision', 'No current opportunity. Checks require a locally observed parked, plugged-in vehicle below its limit, sustained export, and backup above the reserve.')
                  : t('smartCharging.solar.off', 'Solar checks are off for this vehicle.')}</Text>
              )}
              {settings.plan && (
                <Button type="button" variant="ghost" disabled={!allowed} onClick={() => change.mutate({ kind: 'disable' })}>
                  {t('smartCharging.solar.disable', 'Turn off solar checks for this vehicle')}
                </Button>
              )}
              <div>
                <Button type="button" variant="ghost" disabled={!allowed} onClick={() => change.mutate({ kind: 'disconnect' })}>
                  {t('smartCharging.solar.disconnect', 'Disconnect Tesla Energy and remove all solar plans')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
