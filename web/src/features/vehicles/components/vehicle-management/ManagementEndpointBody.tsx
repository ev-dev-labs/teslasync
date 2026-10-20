import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import { deriveDataState, type DataStateSource } from '@/api/dataState'
import {
  AlertBanner,
  DataStateNotice,
  EmptyState,
  ErrorDisplay,
  ListSkeleton,
} from '@/components/feedback'
import {
  managementErrorText,
  type ManagementEndpointKind,
} from './managementJson'
import { ManagementDataView } from './ManagementDataView'

interface ManagementEndpointBodyProps {
  data: unknown
  source?: DataStateSource<unknown>
  loading: boolean
  error?: unknown
  unavailable: boolean
  kind: ManagementEndpointKind
  hasCompletedResult?: boolean
  emptyTitle?: string
  emptyMessage?: string
}

function hasRenderableData(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

export function ManagementEndpointBody({
  data,
  source,
  loading,
  error: suppliedError,
  unavailable,
  kind,
  hasCompletedResult = false,
  emptyTitle,
  emptyMessage,
}: ManagementEndpointBodyProps) {
  const { t } = useTranslation()
  const error = suppliedError ?? source?.error
  const state = deriveDataState(source ? { ...source, error } : { data, error })
  const completed = hasCompletedResult
  const activelyLoading = source
    ? source.fetchStatus === 'fetching' && !state.hasData
    : loading
  const prerequisiteUnavailable =
    isApiError(error) && [402, 412].includes(error.status)

  if (unavailable) {
    return (
      // no-action: Vehicle selection is owned by the workspace selector above the endpoint cards.
      <EmptyState
        title={t('vehicleManagement.state.vehicleRequired', 'Select a vehicle')}
        message={t(
          'vehicleManagement.state.vehicleRequiredDetail',
          'This endpoint is unavailable until a vehicle is selected.',
        )}
        className="py-5"
      />
    )
  }
  const refreshNotice = state.refreshError ? <DataStateNotice
    state="stale"
    title={t('dataState.stale.title', 'Data may be stale')}
    message={t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')}
  /> : state.isRefreshBlocked && state.hasData ? <AlertBanner
    variant="info"
    title={t('dataSources.status.paused', 'Refresh paused')}
  >
    {t('system.outage.refreshPaused', 'Connection paused; source freshness is not confirmed.')}
  </AlertBanner> : null
  if (hasRenderableData(data)) {
    return <>
      {refreshNotice}
      {prerequisiteUnavailable && <DataStateNotice
        state="unsupported"
        title={t('vehicleManagement.state.prerequisiteRequired', 'Prerequisite required')}
        message={managementErrorText(error, t('vehicleManagement.state.prerequisiteError',
          'Tesla did not confirm the required account scope or prerequisite.'))}
      />}
      <ManagementDataView data={data} kind={kind} />
    </>
  }
  if (activelyLoading && !state.hasData && !state.fatalError) {
    return (
      <ListSkeleton
        rows={3}
        label={t('vehicleManagement.state.loading', 'Loading cached data')}
        className="py-2"
        testId="vehicle-management-loading"
      />
    )
  }
  if (prerequisiteUnavailable && !state.hasData) {
    return (
      <DataStateNotice
        state="unsupported"
        title={t(
          'vehicleManagement.state.prerequisiteRequired',
          'Prerequisite required',
        )}
        message={managementErrorText(
          error,
          t(
            'vehicleManagement.state.prerequisiteError',
            'Tesla did not confirm the required account scope or prerequisite.',
          ),
        )}
      />
    )
  }
  if (state.fatalError) {
    return (
      <ErrorDisplay
        error={state.fatalError}
        message={managementErrorText(
          error,
          t(
            'vehicleManagement.state.errorDetail',
            'The request could not be completed.',
          ),
        )}
        compact
      />
    )
  }
  if (source && !state.hasData && !completed) {
    return (
      <AlertBanner
        variant="info"
        title={state.isRefreshBlocked
          ? t('dataSources.status.paused', 'Refresh paused')
          : t('operations.status.awaitingData', 'Awaiting data')}
      >
        {state.isRefreshBlocked
          ? t('system.outage.pausedSource', 'Waiting for a connection before this source can load. Missing evidence remains unknown.')
          : t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.')}
      </AlertBanner>
    )
  }
  if (completed) {
    return (
      <>
      {refreshNotice}
      {/* no-action: Refresh and operation actions are already exposed in the endpoint card header. */}
      <EmptyState
        title={t(
          'vehicleManagement.state.emptyResult',
          'No matching data returned',
        )}
        message={t(
          'vehicleManagement.state.emptyResultDetail',
          'Tesla completed the request but returned no matching data for this vehicle.',
        )}
        className="py-5"
      />
      </>
    )
  }
  return (
    <>
    {refreshNotice}
    {/* no-action: Refresh and operation actions are already exposed in the endpoint card header. */}
    <EmptyState
      title={emptyTitle ?? t('vehicleManagement.state.empty', 'No cached data')}
      message={
        emptyMessage ??
        t(
          'vehicleManagement.state.emptyDetail',
          'Use refresh to request this information from Tesla when the required access is available.',
        )
      }
      className="py-5"
    />
    </>
  )
}
