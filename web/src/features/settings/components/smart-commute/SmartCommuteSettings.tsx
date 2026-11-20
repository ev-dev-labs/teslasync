import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { isApiError } from '@/api/client'
import { useSmartCommute, useSmartCommuteChange, type SmartCommuteChange } from '@/api/hooks/useSmartCommute'
import { personalScope, usePersonalIdentity } from '@/api/hooks/usePersonalIdentity'
import { useVehicles } from '@/api/hooks/useVehicles'
import { DataStateNotice, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { ErrorText, GlassPanel, Select, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { browserTimeZone } from '@/lib/dateFormat'
import { SmartCommuteControls } from './SmartCommuteControls'
import { SmartCommuteRoutines } from './SmartCommuteRoutines'

interface Props {
  active: boolean
}

export function SmartCommuteSettings({ active }: Props) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const operationalMode = useOperationalMode()
  const identity = usePersonalIdentity(active)
  const scope = personalScope(identity.data)
  const vehicles = useVehicles(active)
  const vehicleState = useDataState(vehicles)
  const params = new URLSearchParams(location.search)
  const requested = params.get('vehicle_id')
  const number = requested && /^\d+$/.test(requested) ? Number(requested) : null
  const requestedId = number != null && Number.isSafeInteger(number) && number > 0 ? number : null
  const vehicle = (vehicles.data ?? []).find((item) => item.id === requestedId)
  const vehicleId = vehicle?.id ?? null
  const query = useSmartCommute(scope, vehicleId, active && !identity.isFetching && !identity.isError)
  const state = useDataState(query)
  const change = useSmartCommuteChange(scope, vehicleId)
  const accessDenied = isApiError(query.error) &&
    (query.error.status === 401 || query.error.status === 403 || query.error.status === 404 ||
      query.error.code === 'IDENTITY_CHANGED')
  const disabled = !operationalMode.canWrite || identity.isFetching || identity.isError ||
    state.status !== 'ok' || query.isFetching || vehicleState.status !== 'ok' || vehicles.isFetching || change.isPending

  const selectVehicle = (value: string) => {
    const next = new URLSearchParams(location.search)
    if (value) next.set('vehicle_id', value)
    else next.delete('vehicle_id')
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true })
  }
  const apply = async (input: SmartCommuteChange) => {
    if (disabled) return false
    try {
      await change.mutateAsync(input)
      return true
    } catch {
      return false
    }
  }

  const routines = state.data?.routines ?? []
  const settings = state.data?.settings
  const status = !settings?.enabled
    ? t('smartCommute.states.off', 'Off')
    : settings.paused
      ? t('smartCommute.states.paused', 'Paused')
      : routines.some((item) => item.status === 'suggested')
        ? t('smartCommute.states.review', 'Needs review')
        : routines.some((item) => item.status === 'confirmed')
          ? t('smartCommute.states.saved', 'Routine saved')
          : settings.local_analysis_enabled
            ? t('smartCommute.states.learning', 'Learning on request')
            : t('smartCommute.states.setup', 'Needs setup')

  return (
    <GlassPanel padding="lg" className="space-y-5">
      {!active ? null : identity.isLoading || identity.isFetching ? (
        <Skeleton lines={2} />
      ) : identity.error ? (
        <QueryError error={identity.error} onRetry={() => void identity.refetch()} />
      ) : !scope ? (
        <DataStateNotice state="unavailable" title={t('smartCommute.identityMissing', 'Identity unavailable')}
          message={t('smartCommute.identityMissingDescription', 'Your authentication provider did not supply a verified identity.')} />
      ) : vehicleState.fatalError ? (
        <QueryError error={vehicleState.fatalError} onRetry={() => void vehicles.refetch()} />
      ) : !vehicleState.hasData ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <StaleRefreshWarning state={vehicleState} label={t('smartCommute.vehicle', 'Vehicle')} />
          <Select label={t('smartCommute.vehicle', 'Vehicle')} value={vehicleId == null ? '' : String(vehicleId)}
            placeholder={t('smartCommute.selectVehicle', 'Select a vehicle')}
            options={(vehicles.data ?? []).map((item) => ({ value: String(item.id), label: item.display_name }))}
            onChange={(event) => selectVehicle(event.target.value)} />
          {scope.mode === 'open' && (
            <Text as="p" variant="bodySm">{t('personalScope.sharedRoutines', 'Without sign-in, anyone with access to TeslaSync can view and manage these routines.')}</Text>
          )}
          {requested && !vehicle && (
            <Text as="p" variant="bodySm">{t('smartCommute.vehicleUnavailable', 'That vehicle is unavailable. Select a vehicle explicitly; no other vehicle was selected.')}</Text>
          )}
          {vehicleId == null ? (
            <Text as="p" variant="bodySm">{t('smartCommute.chooseVehicle', 'Choose the vehicle whose routines you want to manage.')}</Text>
          ) : accessDenied ? (
            <QueryError error={query.error} onRetry={() => void query.refetch()} />
          ) : state.fatalError ? (
            <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
          ) : !state.hasData ? (
            <Skeleton lines={3} />
          ) : settings ? (
            <div key={`${JSON.stringify(scope)}:${vehicleId}`} className="space-y-6">
              <StaleRefreshWarning state={state} label={t('smartCommute.title', 'Smart Commute')} />
              {change.error && <ErrorText role="alert">{t('smartCommute.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
              {!operationalMode.canWrite && operationalMode.writeBlockReason && (
                <Text as="p" variant="bodySm">{operationalMode.writeBlockReason}</Text>
              )}
              <SmartCommuteControls settings={settings} stateLabel={status} disabled={disabled}
                busy={change.isPending} onChange={apply} />
              <SmartCommuteRoutines vehicleId={vehicleId} timeZone={settings.time_zone || browserTimeZone()}
                enabled={settings.enabled} disabled={disabled} routines={routines} onChange={apply} />
            </div>
          ) : null}
        </>
      )}
    </GlassPanel>
  )
}
