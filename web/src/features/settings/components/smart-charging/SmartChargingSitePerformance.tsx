import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useSitePerformance, useSmartChargingChange } from '@/api/hooks/useSmartCharging'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, PanelTitle, Select, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useSitePerformanceDisplay } from '@/lib/sitePerformanceDisplay'

interface Props {
  scope: PersonalScope
  vehicleId: number
  places: readonly { id: number; name: string }[]
  disabled: boolean
  placesUnavailable: boolean
}

export function SmartChargingSitePerformance({ scope, vehicleId, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { hash, key } = useLocation()
  const section = useRef<HTMLElement>(null)
  const query = useSitePerformance(scope, vehicleId)
  const state = useDataState(query)
  const change = useSmartChargingChange(scope, vehicleId)
  const [selected, setSelected] = useState('')
  const title = t('smartCharging.sitePerformance.title', 'Charging at a saved place')
  const active = state.data?.scope
  const placeId = selected ? Number(selected) : active?.charging_place_id ?? null
  const canWrite = !disabled && state.status === 'ok' && !query.isFetching && !change.isPending
  const accessDenied = isApiError(query.error) &&
    (query.error.status === 401 || query.error.status === 403 || query.error.code === 'IDENTITY_CHANGED')
  const ready = state.data?.review
  const copy = useSitePerformanceDisplay(state.status === 'ok' && !accessDenied && ready &&
    Date.parse(ready.expires_at) > Date.now() ? ready : null)
  useEffect(() => {
    if (hash === '#site-performance') section.current?.scrollIntoView?.({ block: 'start' })
  }, [hash, key])
  return (
    <section id="site-performance" ref={section} className="scroll-mt-4 space-y-3" aria-label={title}>
      <PanelTitle>{title}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sitePerformance.privacy', 'Off by default. Allow TeslaSync to compare this vehicle’s completed sessions at one reviewed charging place. Nothing is sent outside TeslaSync and this does not enable push.')}
      </Text>
      {accessDenied || state.fatalError ? (
        <QueryError error={accessDenied ? query.error : state.fatalError} onRetry={() => void query.refetch()} />
      ) : !state.hasData ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <StaleRefreshWarning state={state} label={title} />
          <Select label={t('smartCharging.sitePerformance.place', 'Place to compare')} value={placeId == null ? '' : String(placeId)}
            placeholder={t('smartCharging.selectPlace', 'Select a charging place')}
            options={places.map((place) => ({ value: String(place.id), label: place.name }))}
            disabled={!canWrite || placesUnavailable}
            onChange={(event) => setSelected(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary"
              disabled={!canWrite || placesUnavailable || placeId == null ||
                placeId === active?.charging_place_id || !places.some((place) => place.id === placeId)}
              onClick={() => change.mutate({ kind: 'sitePerformance', placeId }, { onSuccess: () => setSelected('') })}>
              {t('smartCharging.sitePerformance.enable', 'Allow this comparison')}
            </Button>
            {active && <Button type="button" variant="ghost" disabled={!canWrite}
              onClick={() => change.mutate({ kind: 'sitePerformance', placeId: null }, { onSuccess: () => setSelected('') })}>
              {t('smartCharging.sitePerformance.revoke', 'Turn off this comparison')}
            </Button>}
          </div>
          {copy ? (
            <div className="space-y-2">
              <Text as="p" weight="semibold">{copy.title}</Text>
              <Text as="p" variant="bodySm">{copy.summary} {copy.dates}</Text>
              <Text as="p" variant="bodySm">{copy.limitation}</Text>
              <div className="flex flex-wrap gap-2">
                <Link to={`/charging/schedule?vehicle_id=${vehicleId}`} className="text-theme-accent underline underline-offset-2">
                  {t('smartCharging.sitePerformance.schedule', 'Review charging settings')}
                </Link>
                <Link to="/geofences" className="text-theme-accent underline underline-offset-2">
                  {t('smartCharging.sitePerformance.locations', 'Review charging places')}
                </Link>
              </div>
            </div>
          ) : active && state.status === 'ok' && (
            <Text as="p" variant="bodySm">{t('smartCharging.sitePerformance.empty', 'No repeated slowdown is supported by comparable sessions for this place.')}</Text>
          )}
        </>
      )}
      {change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
    </section>
  )
}
