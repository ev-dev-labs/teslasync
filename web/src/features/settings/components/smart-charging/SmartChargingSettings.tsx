import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { isApiError } from '@/api/client'
import { useGeofencesFull } from '@/api/hooks/useLocations'
import { personalScope, usePersonalIdentity } from '@/api/hooks/usePersonalIdentity'
import { useSmartCharging, useSmartChargingChange, type SmartChargingChange } from '@/api/hooks/useSmartCharging'
import { useVehicles } from '@/api/hooks/useVehicles'
import { DataStateNotice, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { ErrorText, GlassPanel, Select, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { SmartChargingPlans } from './SmartChargingPlans'
import { SmartChargingSitePerformance } from './SmartChargingSitePerformance'
import { SmartChargingPublicFee } from './SmartChargingPublicFee'
import { SmartChargingSolar } from './SmartChargingSolar'
import { SmartBackupCharging } from './SmartBackupCharging'
import { SharedChargerPlanning } from './SharedChargerPlanning'
import { SharedTripPlanning } from './SharedTripPlanning'

interface Props {
  active: boolean
}

export function SmartChargingSettings({ active }: Props) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const operationalMode = useOperationalMode()
  const identity = usePersonalIdentity(active)
  const scope = personalScope(identity.data)
  const vehicles = useVehicles(active)
  const vehicleState = useDataState(vehicles)
  const requested = new URLSearchParams(location.search).get('vehicle_id')
  const number = requested && /^\d+$/.test(requested) ? Number(requested) : null
  const requestedId = number != null && Number.isSafeInteger(number) && number > 0 ? number : null
  const vehicle = (vehicles.data ?? []).find((item) => item.id === requestedId)
  const vehicleId = vehicle?.id ?? null
  const query = useSmartCharging(scope, vehicleId, active && !identity.isFetching && !identity.isError)
  const state = useDataState(query)
  const placesQuery = useGeofencesFull(false, active && (scope?.mode === 'forward_auth' || (scope != null && vehicleId != null)))
  const placeState = useDataState(placesQuery)
  const change = useSmartChargingChange(scope, vehicleId)
  const accessDenied = isApiError(query.error) &&
    (query.error.status === 401 || query.error.status === 403 || query.error.status === 404 ||
      query.error.code === 'IDENTITY_CHANGED')
  const disabled = !operationalMode.canWrite || identity.isFetching || identity.isError ||
    state.status !== 'ok' || query.isFetching || vehicleState.status !== 'ok' || vehicles.isFetching || change.isPending
  const reviewedPlaces = (placesQuery.data ?? []).filter((place) => place.enabled && !place.needs_review && !place.archived_at)
  const places = reviewedPlaces.filter((place) => place.is_charging_location)
  const formDisabled = placeState.status !== 'ok' || placesQuery.isFetching

  const selectVehicle = (value: string) => {
    const next = new URLSearchParams(location.search)
    if (value) next.set('vehicle_id', value)
    else next.delete('vehicle_id')
    next.delete('fee_session_id')
    next.delete('solar')
    next.delete('backup_watch_id')
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true })
  }
  const apply = async (input: SmartChargingChange) => {
    if (disabled) return false
    try {
      await change.mutateAsync(input)
      return true
    } catch {
      return false
    }
  }

  return (
    <GlassPanel padding="lg" className="space-y-5">
      {!active ? null : identity.isLoading || identity.isFetching ? (
        <Skeleton lines={2} />
      ) : identity.error ? (
        <QueryError error={identity.error} onRetry={() => void identity.refetch()} />
      ) : !scope ? (
        <DataStateNotice state="unavailable" title={t('smartCharging.identityMissing', 'Identity unavailable')}
          message={t('smartCharging.identityMissingDescription', 'Your authentication provider did not supply a verified identity.')} />
      ) : (
        <>
          {vehicleState.fatalError ? (
            <QueryError error={vehicleState.fatalError} onRetry={() => void vehicles.refetch()} />
          ) : !vehicleState.hasData ? (
            <Skeleton lines={2} />
          ) : (
            <>
              <StaleRefreshWarning state={vehicleState} label={t('smartCharging.vehicle', 'Vehicle')} />
              <Select label={t('smartCharging.vehicle', 'Vehicle')} value={vehicleId == null ? '' : String(vehicleId)}
                placeholder={t('smartCharging.selectVehicle', 'Select a vehicle')}
                options={(vehicles.data ?? []).map((item) => ({ value: String(item.id), label: item.display_name }))}
                onChange={(event) => selectVehicle(event.target.value)} />
            </>
          )}
          {scope.mode === 'open' && (
            <Text as="p" variant="bodySm">{t('personalScope.sharedPlans', 'Without sign-in, anyone with access to TeslaSync can view and manage these plans.')}</Text>
          )}
          <SharedChargerPlanning active={active} scope={scope} vehicles={vehicles.data ?? []} places={places}
            disabled={!operationalMode.canWrite}
            choicesUnavailable={formDisabled || vehicleState.status !== 'ok' || vehicles.isFetching} />
          <SharedTripPlanning scope={scope} />
          {vehicleState.hasData && requested && !vehicle && (
            <Text as="p" variant="bodySm">{t('smartCharging.vehicleUnavailable', 'That vehicle is unavailable. Select a vehicle explicitly; no other vehicle was selected.')}</Text>
          )}
          {!vehicleState.hasData ? null : vehicleId == null ? (
            <Text as="p" variant="bodySm">{t('smartCharging.chooseVehicle', 'Choose the vehicle whose charging plans you want to manage.')}</Text>
          ) : accessDenied ? (
            <QueryError error={query.error} onRetry={() => void query.refetch()} />
          ) : state.fatalError ? (
            <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
          ) : !state.hasData ? (
            <Skeleton lines={3} />
          ) : (
            <div key={`${JSON.stringify(scope)}:${vehicleId}`} className="space-y-5">
              <StaleRefreshWarning state={state} label={t('smartCharging.title', 'Charging readiness')} />
              <Text as="p" variant="bodySm">
                {t('smartCharging.description', 'Plans are off until you enable them. The notification worker checks fresh shared signals for unplugged or slow charging without waking the car. Advice appears in Action Center; personal browser notifications require separate device consent.')}
              </Text>
              <Text as="p" variant="bodySm">
                {t('smartCharging.requirements', 'Checks require a running notification worker, shared live signals, and a reviewed place marked as a charging location. Stale or missing evidence produces no advice.')}
              </Text>
              {change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
              {!operationalMode.canWrite && operationalMode.writeBlockReason && (
                <Text as="p" variant="bodySm">{operationalMode.writeBlockReason}</Text>
              )}
              {placeState.fatalError ? (
                <QueryError error={placeState.fatalError} onRetry={() => void placesQuery.refetch()}
                  resourceName={t('smartCharging.places', 'Charging places')} />
              ) : !placeState.hasData ? (
                <Skeleton lines={1} />
              ) : (
                <>
                  <StaleRefreshWarning state={placeState} label={t('smartCharging.places', 'Charging places')} />
                  {places.length === 0 && (
                    <Text as="p" variant="bodySm">
                      {t('smartCharging.noPlaces', 'Add or review a charging place in Locations before creating a plan.')}
                    </Text>
                  )}
                </>
              )}
              <SmartChargingPlans scope={scope} vehicleId={vehicleId} plans={state.data ?? []} places={places}
                reviewedPlaces={reviewedPlaces} disabled={disabled} formDisabled={formDisabled} onChange={apply} />
              <SmartChargingSitePerformance scope={scope} vehicleId={vehicleId} places={places}
                disabled={!operationalMode.canWrite || vehicleState.status !== 'ok' || vehicles.isFetching}
                placesUnavailable={formDisabled} />
              <SmartChargingPublicFee scope={scope} vehicleId={vehicleId} places={places}
                disabled={!operationalMode.canWrite || vehicleState.status !== 'ok' || vehicles.isFetching}
                placesUnavailable={formDisabled} />
              <SmartChargingSolar scope={scope} vehicleId={vehicleId} places={places}
                disabled={!operationalMode.canWrite || vehicleState.status !== 'ok' || vehicles.isFetching}
                placesUnavailable={formDisabled} />
              <SmartBackupCharging scope={scope} vehicleId={vehicleId} places={places}
                disabled={!operationalMode.canWrite || vehicleState.status !== 'ok' || vehicles.isFetching}
                placesUnavailable={formDisabled} />
            </div>
          )}
        </>
      )}
    </GlassPanel>
  )
}
