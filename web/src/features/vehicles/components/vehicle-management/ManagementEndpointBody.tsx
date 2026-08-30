import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import {
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
  loading,
  error,
  unavailable,
  kind,
  hasCompletedResult = false,
  emptyTitle,
  emptyMessage,
}: ManagementEndpointBodyProps) {
  const { t } = useTranslation()
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
  if (loading) {
    return (
      <ListSkeleton
        rows={3}
        label={t('vehicleManagement.state.loading', 'Loading cached data')}
        className="py-2"
        testId="vehicle-management-loading"
      />
    )
  }
  if (prerequisiteUnavailable) {
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
  if (error) {
    return (
      <ErrorDisplay
        error={error}
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
  if (hasRenderableData(data)) {
    return <ManagementDataView data={data} kind={kind} />
  }
  if (hasCompletedResult) {
    return (
      // no-action: Refresh and operation actions are already exposed in the endpoint card header.
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
    )
  }
  return (
    // no-action: Refresh and operation actions are already exposed in the endpoint card header.
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
  )
}
